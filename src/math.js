/**
 * Math utilities for the Trebuchet Splash Distance Tracker.
 * Preserves the exact triangulation formulas from the original client-side app.
 */

function degreesToRadians(deg) {
  return (deg * Math.PI) / 180;
}

function computeShot(angA, angB, baseline) {
  const angP = 180 - angA - angB;
  if (angP <= 0 || angA <= 0 || angB <= 0) {
    return null;
  }

  const rA = degreesToRadians(angA);
  const rB = degreesToRadians(angB);
  const rP = degreesToRadians(angP);

  const AP = (baseline * Math.sin(rB)) / Math.sin(rP);
  const BP = (baseline * Math.sin(rA)) / Math.sin(rP);
  const baselineCheck = Math.sqrt(AP * AP + BP * BP - 2 * AP * BP * Math.cos(rP));
  const px = AP * Math.cos(rA);
  const py = AP * Math.sin(rA);

  return { AP, BP, angP, baselineCheck, px, py };
}

function getTrebuchetPosition(treb) {
  if (!treb) return { x: 0, y: 0 };
  const r = degreesToRadians(treb.angle);
  return {
    x: treb.dist * Math.cos(r),
    y: treb.dist * Math.sin(r)
  };
}

function calculateShot({ angA, angB, baseline, treb = null, label = '', known = null }) {
  const splash = computeShot(angA, angB, baseline);
  if (!splash) {
    return null;
  }

  let tx = 0;
  let ty = 0;
  let trebName = 'Station A';
  let dist = splash.AP;

  if (treb) {
    const pos = getTrebuchetPosition(treb);
    tx = pos.x;
    ty = pos.y;
    trebName = treb.name;
    dist = Math.hypot(splash.px - tx, splash.py - ty);
  }

  return {
    label,
    treb: trebName,
    tx,
    ty,
    angA,
    angB,
    dist,
    check: splash.baselineCheck,
    px: splash.px,
    py: splash.py,
    known: known !== null && known !== undefined && !isNaN(known) ? Number(known) : null
  };
}

module.exports = {
  degreesToRadians,
  computeShot,
  getTrebuchetPosition,
  calculateShot
};
