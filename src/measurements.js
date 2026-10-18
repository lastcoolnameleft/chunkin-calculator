const { calculateHaversineDistance, bearingDifference, bearingsToAngles, calculateShot } = require('./math');

class MeasurementError extends Error {}

function number(value, label, min = -Infinity, max = Infinity) {
  const result = typeof value === 'number' || typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(result) || result < min || result > max) {
    throw new MeasurementError(`${label} must be a finite number${Number.isFinite(min) && Number.isFinite(max) ? ` between ${min} and ${max}` : min === 0 ? ' greater than or equal to zero' : ''}.`);
  }
  return result;
}

function bearing(value, label) {
  return number(value, label, 0, 360) % 360;
}

function gps(value, label, required = true) {
  if (value == null && !required) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MeasurementError(`${label}: enter latitude and longitude or capture GPS at that location.`);
  }
  const result = {
    latitude: number(value.latitude, `${label} latitude`, -90, 90),
    longitude: number(value.longitude, `${label} longitude`, -180, 180),
    accuracy: value.accuracy == null || value.accuracy === '' ? null : number(value.accuracy, `${label} accuracy`, 0),
    capturedAt: null
  };
  if (value.capturedAt != null && value.capturedAt !== '') {
    if (typeof value.capturedAt !== 'string' || !Number.isFinite(Date.parse(value.capturedAt))) {
      throw new MeasurementError(`${label} capture time must be a valid timestamp.`);
    }
    result.capturedAt = new Date(value.capturedAt).toISOString();
  }
  return result;
}

function gpsDistance(launch, landing, unit) {
  return calculateHaversineDistance(launch.latitude, launch.longitude, landing.latitude, landing.longitude, unit);
}

function stationGps(input) {
  const result = {};
  for (const station of ['a', 'b']) {
    const upper = station.toUpperCase();
    const latitude = input[`station_${station}_lat`] ?? input[`station${upper}Lat`];
    const longitude = input[`station_${station}_lng`] ?? input[`station${upper}Lng`];
    const empty = value => value == null || value === '';
    const position = empty(latitude) && empty(longitude) ? null
      : gps({ latitude, longitude }, `Station ${upper} overlay`);
    result[`station_${station}_lat`] = position?.latitude ?? null;
    result[`station_${station}_lng`] = position?.longitude ?? null;
  }
  return result;
}

function compassShot(event, input, treb, label, known) {
  if (!(event.baseline > 0) || event.referenceA == null || event.referenceB == null) {
    throw new MeasurementError('Save the baseline and both station reference bearings first.');
  }
  const bearingA = bearing(input.bearingA, 'Station A impact bearing');
  const bearingB = bearing(input.bearingB, 'Station B impact bearing');
  const angles = bearingsToAngles(event.referenceA, event.referenceB, bearingA, bearingB);
  if (!angles) {
    throw new MeasurementError('These bearings do not meet in front of both stations on the same side of the baseline. Check the forward bearings and station references.');
  }
  const computed = calculateShot({ ...angles, baseline: event.baseline, treb, label, known });
  const crossingAngle = 180 - angles.angA - angles.angB;
  return {
    ...computed,
    measurement: {
      method: 'bearings', unit: event.unit, bearingA, bearingB,
      referenceA: event.referenceA, referenceB: event.referenceB, baseline: event.baseline,
      warning: Math.min(crossingAngle, angles.angA, angles.angB) < 5
        ? 'Shallow sighting geometry: small compass errors can cause large distance errors.' : null
    }
  };
}

function referenceWarning(referenceA, referenceB) {
  if (referenceA == null || referenceB == null) return null;
  return Math.abs(Math.abs(bearingDifference(referenceA, referenceB)) - 180) > 5
    ? 'Station reference bearings are not approximately opposite. Recheck both compasses away from magnetic interference.'
    : null;
}

module.exports = { MeasurementError, number, bearing, gps, gpsDistance, stationGps, compassShot, referenceWarning };
