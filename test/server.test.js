const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createDb } = require('../src/db');
const { createApp } = require('../src/server');

let server;
let baseUrl;
let db;

before(async () => {
  db = createDb(':memory:');
  const app = createApp(db);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  server.close();
  db.close();
});

test('GET / serves frontend index.html', async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.strictEqual(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('Splash Distance Tracker'));
  assert.ok(text.includes('loadAll()'));
});

test('GET and POST /api/setup', async () => {
  let res = await fetch(`${baseUrl}/api/setup`);
  assert.strictEqual(res.status, 200);
  let data = await res.json();
  assert.strictEqual(data, null);

  // Validation failure: negative baseline
  res = await fetch(`${baseUrl}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseline: -5, unit: 'ft' })
  });
  assert.strictEqual(res.status, 400);

  // Validation failure: invalid unit
  res = await fetch(`${baseUrl}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseline: 50, unit: 'yards' })
  });
  assert.strictEqual(res.status, 400);

  // Success
  res = await fetch(`${baseUrl}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseline: 40, unit: 'ft' })
  });
  assert.strictEqual(res.status, 200);
  data = await res.json();
  assert.deepStrictEqual(data, { baseline: 40, unit: 'ft' });
});

test('Trebuchet CRUD endpoints', async () => {
  // Empty list initially
  let res = await fetch(`${baseUrl}/api/trebuchets`);
  let list = await res.json();
  assert.deepStrictEqual(list, []);

  // Validation failure: angle > 180 or angle < -180
  res = await fetch(`${baseUrl}/api/trebuchets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'T1', dist: 10, angle: 200 })
  });
  assert.strictEqual(res.status, 400);

  res = await fetch(`${baseUrl}/api/trebuchets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'T1', dist: 10, angle: -190 })
  });
  assert.strictEqual(res.status, 400);

  // Add trebuchet with negative angle (behind baseline)
  res = await fetch(`${baseUrl}/api/trebuchets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Rearguard', dist: 25, angle: -45 })
  });
  assert.strictEqual(res.status, 201);
  const createdNeg = await res.json();
  assert.strictEqual(createdNeg.angle, -45);

  // Clean up
  await fetch(`${baseUrl}/api/trebuchets/${createdNeg.id}`, { method: 'DELETE' });

  // Add trebuchet
  res = await fetch(`${baseUrl}/api/trebuchets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Alpha', dist: 15, angle: 45 })
  });
  assert.strictEqual(res.status, 201);
  const created = await res.json();
  assert.strictEqual(created.name, 'Alpha');

  // Verify in list
  res = await fetch(`${baseUrl}/api/trebuchets`);
  list = await res.json();
  assert.strictEqual(list.length, 1);

  // Delete
  res = await fetch(`${baseUrl}/api/trebuchets/${created.id}`, { method: 'DELETE' });
  assert.strictEqual(res.status, 200);

  // Verify list empty
  res = await fetch(`${baseUrl}/api/trebuchets`);
  list = await res.json();
  assert.strictEqual(list.length, 0);
});

test('Shots calculation and endpoints', async () => {
  // Add a trebuchet for testing shot with trebuchet
  let res = await fetch(`${baseUrl}/api/trebuchets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Treb One', dist: 20, angle: 60 })
  });
  const treb = await res.json();

  // Invalid angles test (sum to >= 180)
  res = await fetch(`${baseUrl}/api/shots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ angA: 90, angB: 95 })
  });
  assert.strictEqual(res.status, 400);
  let errorData = await res.json();
  assert.ok(errorData.error.includes("don't form a valid triangle"));

  // Shot from Station A (no trebuchet specified)
  res = await fetch(`${baseUrl}/api/shots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'Station A Shot', angA: 60, angB: 60, known: 40 })
  });
  assert.strictEqual(res.status, 201);
  let shot1 = await res.json();
  assert.strictEqual(shot1.label, 'Station A Shot');
  assert.strictEqual(shot1.treb, 'Station A');
  assert.ok(Math.abs(shot1.dist - 40) < 1e-4);
  assert.ok(Math.abs(shot1.check - 40) < 1e-4);
  assert.strictEqual(shot1.known, 40);

  // Shot with trebuchet
  res = await fetch(`${baseUrl}/api/shots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trebId: treb.id, angA: 60, angB: 60 })
  });
  assert.strictEqual(res.status, 201);
  let shot2 = await res.json();
  assert.strictEqual(shot2.treb, 'Treb One');
  assert.ok(Math.abs(shot2.dist - 20) < 1e-4);

  // List shots
  res = await fetch(`${baseUrl}/api/shots`);
  let shots = await res.json();
  assert.strictEqual(shots.length, 2);

  // Delete one shot
  res = await fetch(`${baseUrl}/api/shots/${shot1.id}`, { method: 'DELETE' });
  assert.strictEqual(res.status, 200);

  res = await fetch(`${baseUrl}/api/shots`);
  shots = await res.json();
  assert.strictEqual(shots.length, 1);
  assert.strictEqual(shots[0].id, shot2.id);

  // Clear all shots
  res = await fetch(`${baseUrl}/api/shots`, { method: 'DELETE' });
  assert.strictEqual(res.status, 200);

  res = await fetch(`${baseUrl}/api/shots`);
  shots = await res.json();
  assert.strictEqual(shots.length, 0);
});

test('Favicon returns 204 No Content', async () => {
  const res = await fetch(`${baseUrl}/favicon.ico`);
  assert.strictEqual(res.status, 204);
});

test('Events API and direct event URL routing', async () => {
  // Test direct event HTML route /event/:eventId
  let res = await fetch(`${baseUrl}/event/summer-fest-2025`);
  assert.strictEqual(res.status, 200);
  let text = await res.text();
  assert.ok(text.includes('Splash Distance Tracker'));

  // List events initially (should have default event or empty)
  res = await fetch(`${baseUrl}/api/events`);
  assert.strictEqual(res.status, 200);
  let events = await res.json();
  const initialCount = events.length;

  // Create new event
  res = await fetch(`${baseUrl}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Championship 2025', baseline: 100, unit: 'm' })
  });
  assert.strictEqual(res.status, 201);
  const createdEvent = await res.json();
  assert.strictEqual(createdEvent.name, 'Championship 2025');
  assert.strictEqual(createdEvent.baseline, 100);
  assert.strictEqual(createdEvent.unit, 'm');
  assert.ok(createdEvent.id);

  // Get event by id
  res = await fetch(`${baseUrl}/api/events/${createdEvent.id}`);
  assert.strictEqual(res.status, 200);
  const fetchedEvent = await res.json();
  assert.strictEqual(fetchedEvent.id, createdEvent.id);

  // Scoped setup
  res = await fetch(`${baseUrl}/api/events/${createdEvent.id}/setup`);
  assert.strictEqual(res.status, 200);
  let setup = await res.json();
  assert.strictEqual(setup.baseline, 100);

  res = await fetch(`${baseUrl}/api/events/${createdEvent.id}/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseline: 120, unit: 'm' })
  });
  assert.strictEqual(res.status, 200);
  setup = await res.json();
  assert.strictEqual(setup.baseline, 120);

  // Scoped trebuchet with negative angle behind baseline
  res = await fetch(`${baseUrl}/api/events/${createdEvent.id}/trebuchets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Rearguard Event', dist: 35, angle: -60 })
  });
  assert.strictEqual(res.status, 201);
  const negTreb = await res.json();
  assert.strictEqual(negTreb.angle, -60);
  await fetch(`${baseUrl}/api/events/${createdEvent.id}/trebuchets/${negTreb.id}`, { method: 'DELETE' });

  // Scoped trebuchet
  res = await fetch(`${baseUrl}/api/events/${createdEvent.id}/trebuchets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Goliath', dist: 30, angle: 45 })
  });
  assert.strictEqual(res.status, 201);
  const treb = await res.json();

  res = await fetch(`${baseUrl}/api/events/${createdEvent.id}/trebuchets`);
  let trebs = await res.json();
  assert.strictEqual(trebs.length, 1);
  assert.strictEqual(trebs[0].name, 'Goliath');

  // Scoped shot
  res = await fetch(`${baseUrl}/api/events/${createdEvent.id}/shots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trebId: treb.id, angA: 50, angB: 50 })
  });
  assert.strictEqual(res.status, 201);
  const shot = await res.json();
  assert.strictEqual(shot.treb, 'Goliath');

  res = await fetch(`${baseUrl}/api/events/${createdEvent.id}/shots`);
  let eventShots = await res.json();
  assert.strictEqual(eventShots.length, 1);

  // Delete event
  res = await fetch(`${baseUrl}/api/events/${createdEvent.id}`, { method: 'DELETE' });
  assert.strictEqual(res.status, 200);

  // Verify 404 for deleted event
  res = await fetch(`${baseUrl}/api/events/${createdEvent.id}`);
  assert.strictEqual(res.status, 404);
});

