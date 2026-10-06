const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDb } = require('../src/db');
const { createApp } = require('../src/server');
const { calculateHaversineDistance, calculateBearing } = require('../src/math');

test('GPS overlay fits both anchors while preserving authoritative measured shot geometry', async t => {
  const db = createDb(':memory:');
  const event = db.createEvent({
    id: 'overlay', name: 'Overlay', baseline: 500, unit: 'ft',
    station_a_lat: 40, station_a_lng: -80,
    station_b_lat: 40.00023, station_b_lng: -80
  });
  db.addTrebuchet(event.id, 'At measured B', 500, 0);
  const server = createApp(db).listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  t.after(() => { server.close(); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/events/overlay`;
  const trebs = await (await fetch(base + '/trebuchets')).json();
  assert.ok(Math.abs(trebs[0].geo.lat - event.station_b_lat) < 1e-7);
  assert.ok(Math.abs(trebs[0].geo.lng - event.station_b_lng) < 1e-7);
  const response = await fetch(base + '/shots', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ angA: 60, angB: 60 })
  });
  assert.equal(response.status, 201);
  const shot = await response.json();
  assert.ok(Math.abs(shot.dist - 500) < 1e-8);
  assert.ok(Math.abs(shot.px - 250) < 1e-8);
  assert.ok(Math.abs(shot.py - 500 * Math.sin(Math.PI / 3)) < 1e-8);
  const gpsBaseline = calculateHaversineDistance(40, -80, 40.00023, -80, 'ft');
  const mapDistance = calculateHaversineDistance(40, -80, shot.impactGeo.lat, shot.impactGeo.lng, 'ft');
  assert.ok(Math.abs(mapDistance - gpsBaseline) < .05);
  const bearing = calculateBearing(40, -80, shot.impactGeo.lat, shot.impactGeo.lng);
  assert.ok(Math.abs(bearing - 300) < .1);
  assert.ok(shot.impactGeo.lat > 40 && shot.impactGeo.lat < 40.00023);
  assert.ok(shot.impactGeo.lng < -80);
  assert.equal(db.getSetup(event.id).baseline, 500);
  assert.equal(db.getShots(event.id)[0].dist, shot.dist);
});
