const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDb } = require('../src/db');
const { createApp } = require('../src/server');

test('optional shot details persist on scoped and legacy APIs without changing distances', async t => {
  const db = createDb(':memory:');
  db.createEvent({ id: 'metadata', name: 'Metadata', baseline: 50, unit: 'ft' });
  const server = createApp(db).listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  t.after(() => { server.close(); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/api/events/metadata/shots', '/api/shots']) {
    const post = details => fetch(base + route, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ angA: 60, angB: 60, ...details })
    });
    const res = await post({ ballisticWeight: 12.5, counterweight: 1000, fingerAngle: -15 });
    assert.equal(res.status, 201);
    const shot = await res.json();
    assert.equal(shot.ballisticWeight, 12.5);
    assert.equal(shot.counterweight, 1000);
    assert.equal(shot.fingerAngle, -15);
    assert.equal(shot.weightUnit, 'lb');
    assert.ok(Math.abs(shot.dist - 50) < 1e-8);
    assert.equal(db.getShotById(shot.id).ballisticWeight, 12.5);
    const empty = await (await post({ ballisticWeight: '', counterweight: null })).json();
    assert.equal(empty.ballisticWeight, null);
    assert.equal(empty.counterweight, null);
    assert.equal(empty.fingerAngle, null);
    for (const details of [{ ballisticWeight: -1 }, { counterweight: 'bad' }, { fingerAngle: '12degrees' }, { fingerAngle: false }]) {
      assert.equal((await post(details)).status, 400);
    }
  }
  db.saveSetup('metadata', 50, 'm');
  const res = await fetch(base + '/api/events/metadata/shots', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ angA: 60, angB: 60, ballisticWeight: 0, counterweight: 0, fingerAngle: 0 })
  });
  const shot = await res.json();
  assert.equal(shot.weightUnit, 'kg');
  assert.equal(shot.ballisticWeight, 0);
  assert.equal(shot.fingerAngle, 0);
  const shots = await (await fetch(base + '/api/events/metadata/shots')).json();
  assert.equal(shots[0].weightUnit, 'lb');
});
