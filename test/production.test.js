const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDb } = require('../src/db');
const { createApp } = require('../src/server');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');

test('health checks report database availability without creating default events', async t => {
  const db = createDb(':memory:');
  const server = createApp(db).listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/healthz`;
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.deepEqual(await res.json(), { status: 'ok', revision: process.env.APP_REVISION || 'development' });
  assert.deepEqual(db.getEvents(), []);
  db.close();
  const unavailable = await fetch(url);
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { status: 'unavailable' });
});

test('proxy trust is restricted to configured addresses', t => {
  const db = createDb(':memory:');
  t.after(() => db.close());
  const previous = process.env.TRUST_PROXY;
  t.after(() => {
    if (previous === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previous;
  });
  delete process.env.TRUST_PROXY;
  assert.equal(createApp(db).get('trust proxy'), false);
  process.env.TRUST_PROXY = 'loopback, 172.20.0.0/16';
  const trust = createApp(db).get('trust proxy fn');
  assert.equal(trust('127.0.0.1'), true);
  assert.equal(trust('172.20.0.2'), true);
  assert.equal(trust('198.51.100.1'), false);
});

test('trusted Traefik headers distinguish client unlock limits without trusting additional proxies', async t => {
    const previous = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = 'loopback';
    t.after(() => {
      if (previous === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = previous;
    });
    const db = createDb(':memory:');
    const server = createApp(db).listen(0, '127.0.0.1');
    await new Promise(resolve => server.on('listening', resolve));
    t.after(() => { server.close(); db.close(); });
    const base = `http://127.0.0.1:${server.address().port}`;
    await fetch(base + '/api/events', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Proxy', password: 'shared-password' })
    });
    const login = forwarded => fetch(base + '/api/events/proxy/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': forwarded },
      body: JSON.stringify({ password: 'wrong' })
    });
    for (let attempt = 0; attempt < 10; attempt++) {
      assert.equal((await login('198.51.100.1')).status, 401);
    }
    assert.equal((await login('198.51.100.1')).status, 429);
    assert.equal((await login('198.51.100.2')).status, 401);
    // The nearest untrusted hop wins; an extra claimed client cannot bypass the limit.
    assert.equal((await login('203.0.113.99, 198.51.100.1')).status, 429);
  });

  test('deployment smoke script accepts a fresh empty app and performs no writes', async t => {
    const db = createDb(':memory:');
    const server = createApp(db).listen(0, '127.0.0.1');
    await new Promise(resolve => server.on('listening', resolve));
    t.after(() => { server.close(); db.close(); });
    const result = await promisify(execFile)('bash', [
      path.join(__dirname, '../scripts/check-deploy.sh'),
      `http://127.0.0.1:${server.address().port}`
    ]);
    assert.match(result.stdout, /Deployment checks passed/);
    assert.deepEqual(db.getEvents(), []);
    await assert.rejects(promisify(execFile)('bash', [
      path.join(__dirname, '../scripts/check-deploy.sh'),
      `http://127.0.0.1:${server.address().port}`
    ], { env: { ...process.env, EXPECTED_REVISION: 'not-the-running-release' } }),
    error => error.code === 1 && error.stderr.includes('Deployment revision mismatch'));
  });
