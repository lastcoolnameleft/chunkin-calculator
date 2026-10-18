const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDb } = require('../src/db');
const { createApp } = require('../src/server');
const { calculateShot, bearingsToAngles, bearingDifference } = require('../src/math');
const { gps, gpsDistance } = require('../src/measurements');

async function fixture(t) {
  const db = createDb(':memory:');
  const server = createApp(db).listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  t.after(() => { server.close(); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function post(route, data, expected = 201) {
    const response = await fetch(base + route, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    const body = await response.json();
    assert.equal(response.status, expected, JSON.stringify(body));
    return body;
  }
  return { db, base, post };
}

test('bearing conversion handles north wrap, either side, and non-intersecting forward rays', () => {
  assert.deepEqual(bearingsToAngles(90, 270, 30, 330), { angA: 60, angB: 60, impactSide: 1 });
  assert.deepEqual(bearingsToAngles(90, 270, 150, 210), { angA: 60, angB: 60, impactSide: -1 });
  assert.deepEqual(bearingsToAngles(350, 170, 290, 230), { angA: 60, angB: 60, impactSide: 1 });
  assert.equal(bearingDifference(350, 50), -60);
  for (const readings of [[30, 210], [330, 30], [90, 270], [0, 0]]) {
    assert.equal(bearingsToAngles(90, 270, ...readings), null);
  }
  // Each station can have its own constant compass offset.
  assert.deepEqual(bearingsToAngles(100, 250, 40, 310), { angA: 60, angB: 60, impactSide: 1 });
});

test('compass shots reuse existing math and preserve raw bearings and survey geometry', async t => {
  const { post, db } = await fixture(t);
  const event = await post('/api/events', { name: 'Compass', measurementMode: 'bearings', unit: 'ft' });
  const base = `/api/events/${event.id}`;
  await post(base + '/setup', { baseline: 50, unit: 'ft', referenceA: 90, referenceB: 270 }, 200);
  const trebuchet = await post(base + '/trebuchets', { name: 'Surveyed', dist: 20, bearing: 150 });
  assert.equal(trebuchet.angle, -60);
  const shot = await post(base + '/shots', { trebId: trebuchet.id, bearingA: 30, bearingB: 330 });
  const original = calculateShot({ angA: 60, angB: 60, baseline: 50, treb: { name: 'Surveyed', dist: 20, angle: -60 } });
  for (const field of ['px', 'py', 'tx', 'ty', 'dist', 'check']) {
    assert.ok(Math.abs(shot[field] - original[field]) < 1e-9, field);
  }
  assert.equal(shot.bearingA, 30);
  assert.equal(shot.bearingB, 330);
  assert.equal(shot.referenceA, 90);
  assert.equal(shot.referenceB, 270);
  assert.equal(shot.method, 'bearings');
  const mirrored = await post(base + '/shots', { trebId: trebuchet.id, bearingA: 150, bearingB: 210 });
  assert.ok(mirrored.py < 0);
  assert.ok(Math.abs(mirrored.dist - 30) < 1e-9);
  await post(base + '/shots', { bearingA: 30, bearingB: 330 }, 400);
  await post(base + '/shots', { trebId: trebuchet.id, bearingA: 30, bearingB: 210 }, 400);
  await post(base + '/shots', { trebId: trebuchet.id, angA: 60, angB: 60 }, 400);
  await post(base + '/setup', { baseline: 60, unit: 'ft', referenceA: 100, referenceB: 280 }, 200);
  assert.equal(db.getShotById(shot.id).referenceA, 90);
  assert.equal(db.getShotById(shot.id).dist, shot.dist);
  await post(base + '/setup', { baseline: 60, unit: 'm', referenceA: 100, referenceB: 280 }, 400);
});

test('station references and shallow geometry produce visible warnings', async t => {
  const { post } = await fixture(t);
  const event = await post('/api/events', { name: 'Warnings', measurementMode: 'bearings' });
  const base = `/api/events/${event.id}`;
  const setup = await post(base + '/setup', { baseline: 50, unit: 'ft', referenceA: 90, referenceB: 240 }, 200);
  assert.match(setup.warning, /not approximately opposite/);
  await post(base + '/setup', { baseline: 50, unit: 'ft', referenceA: 90, referenceB: 270 }, 200);
  const trebuchet = await post(base + '/trebuchets', { dist: 0, bearing: 0 });
  const shot = await post(base + '/shots', { trebId: trebuchet.id, bearingA: 1, bearingB: 359 });
  assert.match(shot.warning, /Shallow/);
});

test('GPS events measure launch-to-landing distance without stations or fabricated angles', async t => {
  const { post, db } = await fixture(t);
  for (const unit of ['ft', 'm']) {
    const event = await post('/api/events', { name: `GPS ${unit}`, measurementMode: 'gps', unit });
    const base = `/api/events/${event.id}`;
    assert.equal(event.baseline, 0);
    const launch = { latitude: 0, longitude: 0, accuracy: 3, capturedAt: '2026-10-17T12:00:00Z' };
    const landing = { latitude: 0, longitude: .001, accuracy: 5 };
    const trebuchet = await post(base + '/trebuchets', { name: 'GPS launch', gps: launch });
    assert.equal(trebuchet.dist, null);
    assert.equal(trebuchet.angle, null);
    const shot = await post(base + '/shots', { trebId: trebuchet.id, landingGps: landing });
    assert.ok(Math.abs(shot.dist - 111.19492664455875 * (unit === 'm' ? 1 : 3.280839895)) < 1e-6);
    assert.equal(shot.method, 'gps');
    for (const field of ['angA', 'angB', 'px', 'py', 'tx', 'ty', 'check']) assert.equal(shot[field], null);
    assert.deepEqual(shot.impactGeo, { lat: 0, lng: .001 });
    assert.deepEqual(shot.trebGeo, { lat: 0, lng: 0 });
    assert.equal(shot.launchGps.accuracy, 3);
    assert.equal(shot.landingGps.accuracy, 5);
    assert.equal(db.getShotById(shot.id).dist, shot.dist);
    await post(base + '/shots', { landingGps: landing }, 400);
    await post(base + '/shots', { trebId: trebuchet.id, landingGps: { latitude: 91, longitude: 0 } }, 400);
    await post(base + '/trebuchets', { gps: { latitude: '', longitude: 0 } }, 400);
    await post(base + '/trebuchets', { gps: { latitude: false, longitude: 0 } }, 400);
    await post(base + '/trebuchets', { gps: { latitude: 0, longitude: '12degrees' } }, 400);
  }
});

test('GPS input validates metadata and measures coincident and antimeridian positions', () => {
  for (const input of [
    { latitude: 0 }, { latitude: 0, longitude: 181 }, { latitude: 0, longitude: 0, accuracy: -1 },
    { latitude: 0, longitude: 0, capturedAt: 'invalid' }
  ]) assert.throws(() => gps(input, 'Location'));
  assert.equal(gpsDistance({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }, 'm'), 0);
  const across = gpsDistance({ latitude: 0, longitude: 179.999 }, { latitude: 0, longitude: -179.999 }, 'm');
  assert.ok(across > 222 && across < 223);
});

test('GPS checks are append-only, event-scoped, and never overwrite compass measurements', async t => {
  const { post, db, base: host } = await fixture(t);
  const event = await post('/api/events', { name: 'Checked', measurementMode: 'bearings' });
  const base = `/api/events/${event.id}`;
  const launch = { latitude: 39, longitude: -76, accuracy: 4 };
  const landing = { latitude: 39.001, longitude: -76, accuracy: 7 };
  await post(base + '/setup', { baseline: 50, unit: 'ft', referenceA: 90, referenceB: 270 }, 200);
  const trebuchet = await post(base + '/trebuchets', { dist: 0, bearing: 0, gps: launch });
  const shot = await post(base + '/shots', { trebId: trebuchet.id, bearingA: 30, bearingB: 330 });
  await post(`${base}/shots/${shot.id}/gps-checks`, { landingGps: landing }, 400);
  await post(base + '/setup', { baseline: 50, unit: 'ft', referenceA: 90, referenceB: 270, gpsBackup: true }, 200);
  for (let index = 0; index < 2; index++) {
    const checked = await post(`${base}/shots/${shot.id}/gps-checks`, { landingGps: landing });
    assert.equal(checked.gpsChecks.length, index + 1);
    assert.equal(checked.dist, shot.dist);
    assert.equal(checked.bearingA, shot.bearingA);
    assert.equal(checked.px, shot.px);
    assert.equal(checked.gpsChecks[index].launchGps.accuracy, 4);
    assert.equal(checked.gpsChecks[index].landingGps.accuracy, 7);
  }
  const other = await post('/api/events', { name: 'Other', measurementMode: 'bearings' });
  await post(`/api/events/${other.id}/shots/${shot.id}/gps-checks`, { landingGps: landing }, 404);
  db.setEventPasswordHash(event.id, 'protected');
  await post(`${base}/shots/${shot.id}/gps-checks`, { landingGps: landing }, 401);
  db.setEventPasswordHash(event.id, null);
  const withoutGps = await post(base + '/trebuchets', { dist: 0, bearing: 0 });
  const withoutLaunch = await post(base + '/shots', { trebId: withoutGps.id, bearingA: 30, bearingB: 330 });
  await post(`${base}/shots/${withoutLaunch.id}/gps-checks`, { landingGps: landing }, 400);
  const confirmed = await post(`${base}/shots/${withoutLaunch.id}/gps-checks`, { launchGps: launch, landingGps: landing });
  assert.equal(confirmed.launchGps, null);
  assert.equal(confirmed.gpsChecks[0].launchGps.latitude, 39);
  await fetch(`${host}${base}/trebuchets/${trebuchet.id}`, { method: 'DELETE' });
  const afterDelete = await post(`${base}/shots/${shot.id}/gps-checks`, { landingGps: landing });
  assert.deepEqual(afterDelete.launchGps, shot.launchGps);
  db.deleteEvent(event.id);
  assert.equal(db.raw.prepare('SELECT count(*) AS count FROM gps_checks').get().count, 0);
});

test('measurement mode and compass inputs are validated, including legacy write bypasses', async t => {
  const { post } = await fixture(t);
  await post('/api/events', { name: 'Invalid', measurementMode: 'unknown' }, 400);
  await post('/api/events', { name: 'Invalid baseline', measurementMode: 'bearings', baseline: '50feet' }, 400);
  await post('/api/events', { name: 'Invalid overlay', measurementMode: 'bearings', station_a_lat: 91, station_a_lng: 0 }, 400);
  const event = await post('/api/events', { name: 'Validation', measurementMode: 'bearings' });
  const base = `/api/events/${event.id}`;
  for (const value of [-1, 361, '', false, '60degrees']) {
    await post(base + '/setup', { baseline: 50, unit: 'ft', referenceA: value, referenceB: 270 }, 400);
  }
  await post(base + '/setup', { baseline: '50feet', unit: 'ft', referenceA: 90, referenceB: 270 }, 400);
  await post(base + '/setup', { baseline: 50, unit: 'ft', referenceA: 90, referenceB: 270, gpsBackup: 'true' }, 400);
  await post('/api/shots', { angA: 60, angB: 60 }, 409);
  const setup = await post(base + '/setup', { baseline: 50, unit: 'ft', referenceA: 360, referenceB: 180 }, 200);
  assert.equal(setup.referenceA, 0);
});

test('existing NOT NULL databases migrate without losing shots, launcher links, sessions, or identity sequences', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chunkin-modes-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'tracker.db');
  const old = new Database(filename);
  old.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE events (id TEXT PRIMARY KEY, name TEXT NOT NULL, baseline REAL, unit TEXT, is_configured INTEGER, created_at TEXT, updated_at TEXT);
    CREATE TABLE trebuchets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL, name TEXT NOT NULL, dist REAL NOT NULL, angle REAL NOT NULL,
      created_at TEXT, FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );
    CREATE TABLE shots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL, label TEXT NOT NULL, treb_id INTEGER, treb TEXT NOT NULL,
      tx REAL NOT NULL, ty REAL NOT NULL, angA REAL NOT NULL, angB REAL NOT NULL, dist REAL NOT NULL, check_dist REAL NOT NULL,
      px REAL NOT NULL, py REAL NOT NULL, known REAL, created_at TEXT,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY (treb_id) REFERENCES trebuchets(id) ON DELETE SET NULL
    );
    INSERT INTO events VALUES ('old', 'Existing event', 50, 'ft', 1, '2026-01-01', '2026-01-01');
    INSERT INTO trebuchets VALUES (1, 'old', 'Existing launcher', 20, -60, '2026-01-01');
    INSERT INTO shots VALUES (1, 'old', 'Existing shot', 1, 'Existing launcher', 10, -17.320508, 60, 60, 62.45, 50, 25, 43.30127, NULL, '2026-01-01');
    INSERT INTO shots VALUES (99, 'old', 'Deleted shot', 1, 'Existing launcher', 0, 0, 60, 60, 50, 50, 25, 43.30127, NULL, '2026-01-01');
    DELETE FROM shots WHERE id = 99;
    CREATE INDEX existing_shot_index ON shots (event_id);
  `);
  old.close();
  let db = createDb(filename);
  assert.equal(db.getEventById('old').measurementMode, 'angles');
  assert.equal(db.getShotById(1).treb_id, 1);
  assert.equal(db.getShotById(1).dist, 62.45);
  db.saveEditingSession('old', 'session-hash');
  db.createEvent({ id: 'gps', name: 'New GPS', measurementMode: 'gps' });
  const launcher = db.addTrebuchet('gps', 'GPS launcher', null, null, { gps: { latitude: 0, longitude: 0 } });
  const shot = db.addShot({ eventId: 'gps', label: 'GPS shot', treb_id: launcher.id, treb: launcher.name, dist: 10, measurement: { method: 'gps' } });
  assert.equal(shot.id, 100);
  db.close();
  db = createDb(filename);
  assert.equal(db.getShotById(1).treb_id, 1);
  assert.equal(db.getShotById(100).angA, null);
  assert.equal(db.hasEditingSession('old', 'session-hash'), true);
  assert.ok(db.raw.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'existing_shot_index'").get());
  assert.deepEqual(db.raw.pragma('foreign_key_check'), []);
  db.deleteEvent('gps');
  assert.equal(db.getShotById(100), null);
  db.close();
});
