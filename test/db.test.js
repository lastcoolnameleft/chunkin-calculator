const { test } = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../src/db.js');

test('db setup CRUD works', () => {
  const db = createDb(':memory:');
  assert.strictEqual(db.getSetup(), null);

  const saved = db.saveSetup(50, 'ft');
  assert.deepStrictEqual(saved, { baseline: 50, unit: 'ft' });

  const updated = db.saveSetup(25, 'm');
  assert.deepStrictEqual(updated, { baseline: 25, unit: 'm' });

  assert.deepStrictEqual(db.getSetup(), { baseline: 25, unit: 'm' });
  db.close();
});

test('db trebuchets CRUD works', () => {
  const db = createDb(':memory:');
  assert.deepStrictEqual(db.getTrebuchets(), []);

  const t1 = db.addTrebuchet('Treb Alpha', 10.5, 30);
  assert.strictEqual(t1.id, 1);
  assert.strictEqual(t1.name, 'Treb Alpha');
  assert.strictEqual(t1.dist, 10.5);
  assert.strictEqual(t1.angle, 30);

  const t2 = db.addTrebuchet('Treb Beta', 15.0, 45);
  assert.strictEqual(t2.id, 2);

  const list = db.getTrebuchets();
  assert.strictEqual(list.length, 2);

  const del = db.deleteTrebuchet(1);
  assert.strictEqual(del, true);
  assert.strictEqual(db.getTrebuchets().length, 1);
  assert.strictEqual(db.getTrebuchets()[0].name, 'Treb Beta');

  db.close();
});

test('db shots CRUD works', () => {
  const db = createDb(':memory:');
  assert.deepStrictEqual(db.getShots(), []);

  const shot = db.addShot({
    label: 'Shot 1',
    treb_id: null,
    treb: 'Station A',
    tx: 0,
    ty: 0,
    angA: 45,
    angB: 45,
    dist: 35.5,
    check: 50.0,
    px: 25.1,
    py: 25.1,
    known: 36.0
  });

  assert.strictEqual(shot.id, 1);
  assert.strictEqual(shot.label, 'Shot 1');
  assert.strictEqual(shot.check, 50.0);
  assert.strictEqual(shot.known, 36.0);

  const all = db.getShots();
  assert.strictEqual(all.length, 1);

  const del = db.deleteShot(1);
  assert.strictEqual(del, true);
  assert.deepStrictEqual(db.getShots(), []);

  // Test clearShots
  db.addShot({
    label: 'Shot 2',
    treb_id: null,
    treb: 'Station A',
    tx: 0,
    ty: 0,
    angA: 40,
    angB: 40,
    dist: 30,
    check: 50,
    px: 20,
    py: 20,
    known: null
  });
  assert.strictEqual(db.getShots().length, 1);
  db.clearShots();
  assert.deepStrictEqual(db.getShots(), []);

  db.close();
});

test('db events and event-scoped CRUD works', () => {
  const db = createDb(':memory:');
  assert.deepStrictEqual(db.getEvents(), []);

  const ev1 = db.createEvent('Event Alpha', 60, 'ft');
  assert.ok(ev1.id);
  assert.strictEqual(ev1.name, 'Event Alpha');
  assert.strictEqual(ev1.baseline, 60);
  assert.strictEqual(ev1.unit, 'ft');

  const ev2 = db.createEvent('Event Beta');
  assert.strictEqual(ev2.name, 'Event Beta');
  assert.strictEqual(ev2.baseline, 0);

  assert.strictEqual(db.getEvents().length, 2);

  // Setup per event
  assert.deepStrictEqual(db.getSetup(ev1.id), { baseline: 60, unit: 'ft' });
  db.saveSetup(ev1.id, 75, 'm');
  assert.deepStrictEqual(db.getSetup(ev1.id), { baseline: 75, unit: 'm' });

  // Trebuchets per event
  const t1 = db.addTrebuchet(ev1.id, 'Treb 1', 10, 45);
  const t2 = db.addTrebuchet(ev2.id, 'Treb 2', 20, 60);
  assert.strictEqual(db.getTrebuchets(ev1.id).length, 1);
  assert.strictEqual(db.getTrebuchets(ev2.id).length, 1);
  assert.strictEqual(db.getTrebuchets(ev1.id)[0].name, 'Treb 1');
  assert.strictEqual(db.getTrebuchets(ev2.id)[0].name, 'Treb 2');

  // Shots per event
  db.addShot({
    eventId: ev1.id,
    label: 'Shot Alpha',
    treb_id: t1.id,
    treb: 'Treb 1',
    tx: 0,
    ty: 0,
    angA: 45,
    angB: 45,
    dist: 30,
    check: 75,
    px: 20,
    py: 20,
    known: null
  });

  assert.strictEqual(db.getShots(ev1.id).length, 1);
  assert.strictEqual(db.getShots(ev2.id).length, 0);

  // Delete event cascades
  db.deleteEvent(ev1.id);
  assert.strictEqual(db.getEvents().length, 1);
  assert.strictEqual(db.getTrebuchets(ev1.id).length, 0);
  assert.strictEqual(db.getShots(ev1.id).length, 0);

  db.close();
});

