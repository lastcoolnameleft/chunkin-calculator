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

