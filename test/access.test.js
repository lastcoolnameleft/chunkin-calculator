const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDb } = require('../src/db');
const { createApp } = require('../src/server');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function fixture(t) {
  const db = createDb(':memory:');
  const server = createApp(db).listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  t.after(() => { server.close(); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    db,
    async request(path, method = 'GET', body, token) {
      return fetch(base + path, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    }
  };
}

test('spectator routes and event reads remain public; all protected writes require a session', async t => {
  const { db, request } = await fixture(t);
  const created = await request('/api/events', 'POST', {
    name: 'Protected', baseline: 50, unit: 'ft', password: 'shared-password'
  });
  assert.equal(created.status, 201);
  const event = await created.json();
  const path = `/api/events/${event.id}`;
  assert.equal(event.passwordProtected, true);
  assert.ok(!JSON.stringify(event).includes('password_hash'));
  assert.notEqual(db.getEventPasswordHash(event.id), 'shared-password');
  assert.equal((await request(`/event/${event.id}/spectator`)).status, 200);
  for (const suffix of ['', '/setup', '/trebuchets', '/shots', '/access']) {
    const res = await request(path + suffix);
    assert.equal(res.status, 200);
    assert.ok(!(await res.text()).includes(db.getEventPasswordHash(event.id)));
  }
  assert.equal((await request(path + '/session', 'POST', { password: 'wrong' })).status, 401);
  for (const [suffix, method, body] of [
    ['/setup', 'POST', { baseline: 60, unit: 'ft' }],
    ['/trebuchets', 'POST', { dist: 10, angle: 30 }],
    ['/shots', 'POST', { angA: 45, angB: 45 }],
    ['/trebuchets/1', 'DELETE'], ['/shots/1', 'DELETE'],
    ['/shots', 'DELETE'], ['', 'DELETE'], ['/password', 'PUT', { password: '' }]
  ]) {
    assert.equal((await request(path + suffix, method, body)).status, 401);
  }
  for (const [legacy, method] of [
    ['/api/setup', 'POST'], ['/api/trebuchets', 'POST'],
    ['/api/shots', 'POST'], ['/api/trebuchets/1', 'DELETE'],
    ['/api/shots/1', 'DELETE'], ['/api/shots', 'DELETE']
  ]) {
    assert.equal((await request(legacy, method, {})).status, 401);
  }
  const login = await request(path + '/session', 'POST', { password: 'shared-password' });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  assert.deepEqual(await (await request(path + '/access', 'GET', undefined, token)).json(),
    { passwordProtected: true, editable: true });
  const trebRes = await request(path + '/trebuchets', 'POST',
    { name: 'Alpha', dist: 10, angle: -45 }, token);
  assert.equal(trebRes.status, 201);
  const treb = await trebRes.json();
  const shotRes = await request(path + '/shots', 'POST',
    { trebId: treb.id, angA: 60, angB: 60 }, token);
  assert.equal(shotRes.status, 201);
  const shot = await shotRes.json();
  assert.equal((await request(path + `/shots/${shot.id}`, 'DELETE', undefined, token)).status, 200);
  assert.equal((await request('/api/setup', 'POST', { baseline: 75, unit: 'ft' }, token)).status, 200);
  assert.equal((await request(path + `/trebuchets/${treb.id}`, 'DELETE', undefined, token)).status, 200);
  assert.equal((await request(path + '/shots', 'DELETE', undefined, token)).status, 200);
  assert.equal((await request(path, 'DELETE', undefined, token)).status, 200);
});

test('passwords are optional, sessions are event-specific, and changing passwords invalidates sessions', async t => {
  const { request } = await fixture(t);
  const open = await (await request('/api/events', 'POST', { name: 'Open' })).json();
  const path = `/api/events/${open.id}`;
  assert.equal(open.passwordProtected, false);
  assert.equal((await request(path + '/setup', 'POST', { baseline: 50, unit: 'ft' })).status, 200);
  assert.equal((await request(path + '/password', 'PUT', { password: 'first' })).status, 200);
  const { token } = await (await request(path + '/session', 'POST', { password: 'first' })).json();
  const other = await (await request('/api/events', 'POST', { name: 'Other', password: 'first' })).json();
  assert.equal((await request(`/api/events/${other.id}/shots`, 'DELETE', undefined, token)).status, 401);
  assert.equal((await request(path + '/password', 'PUT', { password: 'second' }, token)).status, 200);
  assert.equal((await request(path + '/shots', 'DELETE', undefined, token)).status, 401);
  assert.equal((await request(path + '/session', 'POST', { password: 'first' })).status, 401);
  const session = await (await request(path + '/session', 'POST', { password: 'second' })).json();
  assert.equal((await request(path + '/password', 'PUT', { password: '' }, session.token)).status, 200);
  assert.equal((await request(path + '/shots', 'DELETE')).status, 200);
});

test('invalid passwords and repeated wrong unlock attempts are rejected', async t => {
  const { request } = await fixture(t);
  for (const password of [null, 123, 'x'.repeat(129)]) {
    assert.equal((await request('/api/events', 'POST', { name: 'Invalid', password })).status, 400);
  }
  const event = await (await request('/api/events', 'POST', { name: 'Limited', password: 'right' })).json();
  const path = `/api/events/${event.id}/session`;
  for (let i = 0; i < 10; i++) {
    assert.equal((await request(path, 'POST', { password: 'wrong' })).status, 401);
  }
  assert.equal((await request(path, 'POST', { password: 'right' })).status, 429);
});

test('database adds password storage without changing existing event metadata', async t => {
  const { db } = await fixture(t);
  const event = db.createEvent({ id: 'existing', name: 'Existing' });
  assert.equal(db.getEventPasswordHash(event.id), null);
  db.setEventPasswordHash(event.id, 'salt:hash');
  assert.deepEqual(db.getEventById(event.id), event);
  assert.ok(db.raw.prepare('PRAGMA table_info(events)').all().some(c => c.name === 'password_hash'));
});

test('editing sessions remain trusted until explicitly revoked, including backend restarts', async t => {
  const { request, db } = await fixture(t);
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const event = await (await request('/api/events', 'POST', { name: 'Expiring', password: 'shared' })).json();
  const base = `/api/events/${event.id}`;
  const { token } = await (await request(base + '/session', 'POST', { password: 'shared' })).json();
  assert.equal((await request(base + '/shots', 'DELETE', undefined, token)).status, 200);
  now += 365 * 24 * 60 * 60 * 1000;
  assert.equal((await request(base + '/shots', 'DELETE', undefined, token)).status, 200);
  const restarted = createApp(db).listen(0, '127.0.0.1');
  await new Promise(resolve => restarted.on('listening', resolve));
  t.after(() => restarted.close());
  const url = `http://127.0.0.1:${restarted.address().port}${base}/access`;
  const access = await (await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.equal(access.editable, true);
  assert.equal((await request(base + '/session', 'DELETE', undefined, token)).status, 200);
  assert.equal((await request(base + '/shots', 'DELETE', undefined, token)).status, 401);
});

test('existing database migrates without losing events and password hashes persist on reopening', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chunkin-access-'));
  const filename = path.join(directory, 'tracker.db');
  t.after(() => {
    fs.unlinkSync(filename);
    fs.rmdirSync(directory);
  });
  const legacy = new Database(filename);
  legacy.exec(`
    CREATE TABLE events (
      id TEXT PRIMARY KEY, name TEXT, baseline REAL, unit TEXT, is_configured INTEGER,
      created_at TEXT, updated_at TEXT
    );
    INSERT INTO events VALUES ('legacy', 'Existing event', 50, 'ft', 1, '2026-01-01', '2026-01-01');
  `);
  legacy.close();
  let db = createDb(filename);
  try {
    assert.equal(db.getEventById('legacy').name, 'Existing event');
    assert.equal(db.getSetup('legacy').baseline, 50);
    assert.equal(db.getEventPasswordHash('legacy'), null);
    db.setEventPasswordHash('legacy', 'persisted-salt:persisted-hash');
    db.saveEditingSession('legacy', 'persisted-token-hash');
  } finally {
    db.close();
  }
  db = createDb(filename);
  try {
    assert.equal(db.getEventPasswordHash('legacy'), 'persisted-salt:persisted-hash');
    assert.ok(!('password_hash' in db.getEventById('legacy')));
    assert.equal(db.hasEditingSession('legacy', 'persisted-token-hash'), true);
  } finally {
    db.close();
  }
});
