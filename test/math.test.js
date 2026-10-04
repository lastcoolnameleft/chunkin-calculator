const { test } = require('node:test');
const assert = require('node:assert');
const { computeShot, calculateShot, getTrebuchetPosition } = require('../src/math.js');

test('computeShot returns null for angles that add up to 180 or more', () => {
  assert.strictEqual(computeShot(90, 90, 40), null);
  assert.strictEqual(computeShot(100, 85, 40), null);
  assert.strictEqual(computeShot(0, 45, 40), null);
  assert.strictEqual(computeShot(45, -10, 40), null);
});

test('computeShot correctly calculates equilateral triangle', () => {
  // Baseline = 40, angA = 60, angB = 60 -> equilateral triangle, AP = 40, BP = 40
  const result = computeShot(60, 60, 40);
  assert.ok(result);
  assert.strictEqual(result.angP, 60);
  assert.ok(Math.abs(result.AP - 40) < 1e-5);
  assert.ok(Math.abs(result.BP - 40) < 1e-5);
  assert.ok(Math.abs(result.baselineCheck - 40) < 1e-5);
  assert.ok(Math.abs(result.px - 20) < 1e-5); // 40 * cos(60) = 20
  assert.ok(Math.abs(result.py - 40 * Math.sin(Math.PI / 3)) < 1e-5);
});

test('calculateShot without trebuchet defaults to Station A', () => {
  const shot = calculateShot({
    angA: 60,
    angB: 60,
    baseline: 40,
    treb: null,
    label: 'Shot 1'
  });
  assert.ok(shot);
  assert.strictEqual(shot.treb, 'Station A');
  assert.strictEqual(shot.tx, 0);
  assert.strictEqual(shot.ty, 0);
  assert.ok(Math.abs(shot.dist - 40) < 1e-5);
  assert.ok(Math.abs(shot.check - 40) < 1e-5);
});

test('calculateShot with surveyed trebuchet calculates distance from trebuchet', () => {
  // Suppose Trebuchet is at distance 20, angle 60 from Station A.
  // Splash is at distance 40, angle 60 from Station A.
  // Straight line distance from Treb to Splash should be 40 - 20 = 20!
  const treb = { name: 'Catapult 1', dist: 20, angle: 60 };
  const shot = calculateShot({
    angA: 60,
    angB: 60,
    baseline: 40,
    treb,
    label: 'Shot 2',
    known: 20
  });
  assert.ok(shot);
  assert.strictEqual(shot.treb, 'Catapult 1');
  assert.ok(Math.abs(shot.dist - 20) < 1e-5);
  assert.strictEqual(shot.known, 20);
});

test('calculateShot with negative angle trebuchet behind baseline', () => {
  // Trebuchet is 30 ft behind Station A at angle -90° (due south/inland).
  // tx = 30 * cos(-90°) = 0, ty = 30 * sin(-90°) = -30.
  // Splash is at angA = 90°, angB = 45°, baseline = 30 ft.
  // angP = 180 - 90 - 45 = 45°. AP = 30 * sin(45) / sin(45) = 30 ft.
  // px = 30 * cos(90°) = 0, py = 30 * sin(90°) = 30.
  // Distance from trebuchet (0, -30) to splash (0, 30) = 60 ft!
  const treb = { name: 'Rear Treb', dist: 30, angle: -90 };
  const pos = getTrebuchetPosition(treb);
  assert.ok(Math.abs(pos.x - 0) < 1e-5);
  assert.ok(Math.abs(pos.y - (-30)) < 1e-5);

  const shot = calculateShot({
    angA: 90,
    angB: 45,
    baseline: 30,
    treb,
    label: 'Shot Behind Line'
  });
  assert.ok(shot);
  assert.strictEqual(shot.treb, 'Rear Treb');
  assert.ok(Math.abs(shot.dist - 60) < 1e-5);
});

test('calculateBearing calculates correct initial compass azimuth', () => {
  const { calculateBearing } = require('../src/math.js');
  // Due North: (0, 0) -> (10, 0) => bearing 0°
  const northBearing = calculateBearing(0, 0, 10, 0);
  assert.ok(Math.abs(northBearing - 0) < 1e-4);

  // Due East: (0, 0) -> (0, 10) => bearing 90°
  const eastBearing = calculateBearing(0, 0, 0, 10);
  assert.ok(Math.abs(eastBearing - 90) < 1e-4);

  // Due South: (10, 0) -> (0, 0) => bearing 180°
  const southBearing = calculateBearing(10, 0, 0, 0);
  assert.ok(Math.abs(southBearing - 180) < 1e-4);

  // Due West: (0, 10) -> (0, 0) => bearing 270°
  const westBearing = calculateBearing(0, 0, 0, -10);
  assert.ok(Math.abs(westBearing - 270) < 1e-4);
});

test('calculateHaversineDistance calculates great circle distance', () => {
  const { calculateHaversineDistance } = require('../src/math.js');
  // Distance between poles: ~20015 km in meters
  const halfCircumferenceMeters = calculateHaversineDistance(90, 0, -90, 0, 'm');
  assert.ok(Math.abs(halfCircumferenceMeters - 20015086) < 1000);

  // Unit conversion to feet: 1 m ≈ 3.28084 ft
  const halfCircumferenceFeet = calculateHaversineDistance(90, 0, -90, 0, 'ft');
  assert.ok(Math.abs(halfCircumferenceFeet - halfCircumferenceMeters * 3.28084) < 100);
});

test('localXYToLatLng transforms local Cartesian coordinates to geodetic lat/lng', () => {
  const { localXYToLatLng, calculateHaversineDistance, calculateBearing } = require('../src/math.js');
  // Station A at (40.0, -80.0)
  // Station B is due North at (40.001, -80.0) -> baseline is oriented at bearing 0°
  const latA = 40.0;
  const lngA = -80.0;
  const latB = 40.001;
  const lngB = -80.0;

  // Station A is (0, 0), Station B is along the positive X-axis
  // Test point on X-axis (towards Station B)
  const bearingAB = calculateBearing(latA, lngA, latB, lngB);
  const distAB = calculateHaversineDistance(latA, lngA, latB, lngB, 'm');
  const ptB = localXYToLatLng(distAB, 0, latA, lngA, bearingAB, 'm');
  assert.ok(ptB);
  assert.ok(Math.abs(ptB.lat - latB) < 1e-5);
  assert.ok(Math.abs(ptB.lng - lngB) < 1e-5);

  // Test point at (0, 0) maps to Station A
  const ptA = localXYToLatLng(0, 0, latA, lngA, bearingAB, 'm');
  assert.ok(ptA);
  assert.ok(Math.abs(ptA.lat - latA) < 1e-6);
  assert.ok(Math.abs(ptA.lng - lngA) < 1e-6);

  // Test point with positive Y (into the water, 90° counter-clockwise from baseline)
  // Baseline bearing is 0° (North), so 90° CCW is 270° (West)
  const ptWest = localXYToLatLng(0, 100, latA, lngA, bearingAB, 'm');
  assert.ok(ptWest);
  // Point should have approximately same latitude and slightly lower (more negative) longitude
  assert.ok(Math.abs(ptWest.lat - latA) < 1e-4);
  assert.ok(ptWest.lng < lngA);
  const bearingToWest = calculateBearing(latA, lngA, ptWest.lat, ptWest.lng);
  assert.ok(Math.abs(bearingToWest - 270) < 1e-2);
});


