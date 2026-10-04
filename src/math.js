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

function radiansToDegrees(rad) {
  return (rad * 180) / Math.PI;
}

/**
 * Approximate Earth radius in standard units.
 * Mean radius: 6,371,000 meters ~ 20,902,231 feet.
 */
const EARTH_RADIUS = {
  m: 6371000,
  ft: 6371000 * 3.280839895
};

/**
 * Computes forward geodetic azimuth (bearing) from Station A to Station B in degrees [0, 360).
 * Bearing is measured clockwise from True North.
 */
function calculateBearing(lat1, lon1, lat2, lon2) {
  const phi1 = degreesToRadians(lat1);
  const phi2 = degreesToRadians(lat2);
  const deltaLambda = degreesToRadians(lon2 - lon1);

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const theta = Math.atan2(y, x);

  return (radiansToDegrees(theta) + 360) % 360;
}

/**
 * Computes distance between two coordinates using the Haversine formula.
 */
function calculateHaversineDistance(lat1, lon1, lat2, lon2, unit = 'ft') {
  const R = EARTH_RADIUS[unit] || EARTH_RADIUS.ft;
  const phi1 = degreesToRadians(lat1);
  const phi2 = degreesToRadians(lat2);
  const deltaPhi = degreesToRadians(lat2 - lat1);
  const deltaLambda = degreesToRadians(lon2 - lon1);

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Converts a local (x, y) coordinate relative to Station A into a geographic (lat, lng).
 *
 * In our triangulation model:
 * - Station A is (0, 0)
 * - The positive x-axis points from Station A towards Station B (azimuth = bearingAB)
 * - The positive y-axis points into the lake (+90 degrees counter-clockwise from the AB axis).
 *   In standard navigation compass bearings (where North=0, East=90, clockwise):
 *   Pointing +90 deg counter-clockwise from bearingAB corresponds to compass bearing: (bearingAB - 90 deg).
 *
 * Therefore, for any local point (x, y):
 * distance r = sqrt(x^2 + y^2)
 * local polar angle alpha = atan2(y, x)
 * geographic travel bearing = (bearingAB - alpha)
 */
function localXYToLatLng(x, y, stationALat, stationALng, bearingAB, unit = 'ft') {
  const r = Math.hypot(x, y);
  if (r === 0) {
    return { lat: Number(stationALat), lng: Number(stationALng) };
  }

  const R = EARTH_RADIUS[unit] || EARTH_RADIUS.ft;
  const alpha = radiansToDegrees(Math.atan2(y, x));
  const travelBearing = (bearingAB - alpha + 360) % 360;

  const phi1 = degreesToRadians(stationALat);
  const lambda1 = degreesToRadians(stationALng);
  const theta = degreesToRadians(travelBearing);
  const angularDist = r / R;

  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(angularDist) +
    Math.cos(phi1) * Math.sin(angularDist) * Math.cos(theta)
  );

  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(angularDist) * Math.cos(phi1),
      Math.cos(angularDist) - Math.sin(phi1) * Math.sin(phi2)
    );

  return {
    lat: Number(radiansToDegrees(phi2).toFixed(7)),
    lng: Number(radiansToDegrees(lambda2).toFixed(7))
  };
}

module.exports = {
  degreesToRadians,
  radiansToDegrees,
  computeShot,
  getTrebuchetPosition,
  calculateShot,
  calculateBearing,
  calculateHaversineDistance,
  localXYToLatLng
};
