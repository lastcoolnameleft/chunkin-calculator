const express = require('express');
const path = require('path');
const { createDb } = require('./db');
const { calculateShot, calculateBearing, calculateHaversineDistance, localXYToLatLng, bearingDifference } = require('./math');
const measurements = require('./measurements');
const { hashPassword, createAuth } = require('./auth');
const { renderGuide } = require('./guide');

function enrichWithGeo(point, event, unit) {
  if (point.gps) point.geo = { lat: point.gps.latitude, lng: point.gps.longitude };
  if (point.launchGps) point.trebGeo = point.treb_geo = { lat: point.launchGps.latitude, lng: point.launchGps.longitude };
  if (point.landingGps) point.impactGeo = point.impact_geo = { lat: point.landingGps.latitude, lng: point.landingGps.longitude };
  if (point.method === 'gps') return point;
  if (
    !event ||
    event.station_a_lat === null ||
    event.station_a_lat === undefined ||
    event.station_a_lng === null ||
    event.station_a_lng === undefined ||
    event.station_b_lat === null ||
    event.station_b_lat === undefined ||
    event.station_b_lng === null ||
    event.station_b_lng === undefined
  ) {
    return point;
  }

  const bearingAB = calculateBearing(
    event.station_a_lat,
    event.station_a_lng,
    event.station_b_lat,
    event.station_b_lng
  );
  const gpsBaseline = calculateHaversineDistance(
    event.station_a_lat, event.station_a_lng,
    event.station_b_lat, event.station_b_lng, unit
  );
  if (!(event.baseline > 0) || !(gpsBaseline > 0)) return point;
  // Fit the display to both GPS anchors without altering any measured coordinates or distances.
  const overlayScale = gpsBaseline / event.baseline;
  const overlayPosition = (x, y) => localXYToLatLng(
    x * overlayScale, y * overlayScale,
    event.station_a_lat, event.station_a_lng, bearingAB, unit
  );

  // If point has tx, ty (e.g. shot launcher location)
  if (!point.launchGps && typeof point.tx === 'number' && typeof point.ty === 'number') {
    const geo = overlayPosition(point.tx, point.ty);
    point.treb_geo = geo;
    point.trebGeo = geo;
  }
  // If point has px, py (e.g. shot impact location)
  if (typeof point.px === 'number' && typeof point.py === 'number') {
    const geo = overlayPosition(point.px, point.py);
    point.impact_geo = geo;
    point.impactGeo = geo;
  }
  // If point has dist and angle (e.g. trebuchet definition)
  if (!point.gps && typeof point.dist === 'number' && typeof point.angle === 'number') {
    const rad = (point.angle * Math.PI) / 180;
    const x = point.dist * Math.cos(rad);
    const y = point.dist * Math.sin(rad);
    point.geo = overlayPosition(x, y);
  }

  return point;
}

function createApp(db) {
  const app = express();
  function respondError(res, err) {
    res.status(err instanceof measurements.MeasurementError ? 400 : 500).json({ error: err.message });
  }
  const proxyAddresses = (process.env.TRUST_PROXY || '').split(',').map(value => value.trim()).filter(Boolean);
  if (proxyAddresses.length) app.set('trust proxy', proxyAddresses);
  app.disable('x-powered-by');
  app.get('/healthz', (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      db.raw.prepare('SELECT 1 FROM events LIMIT 1').get();
      res.json({ status: 'ok', revision: process.env.APP_REVISION || 'development' });
    } catch (err) {
      console.error('Database health check failed:', err.message);
      res.status(503).json({ status: 'unavailable' });
    }
  });
  function shotMetadata(req, res, setup) {
    const result = { weightUnit: setup.unit === 'm' ? 'kg' : 'lb' };
    for (const [key, label] of [
      ['ballisticWeight', 'Ballistic weight'], ['counterweight', 'Counterweight'], ['fingerAngle', 'Finger angle']
    ]) {
      const value = req.body[key];
      if (value === undefined || value === null || value === '') {
        result[key] = null;
        continue;
      }
      const number = typeof value === 'number' || typeof value === 'string' && value.trim() ? Number(value) : NaN;
      if (!Number.isFinite(number) || key !== 'fingerAngle' && number < 0) {
        res.status(400).json({ error: `${label} must be ${key === 'fingerAngle' ? 'a finite number in degrees' : 'a non-negative finite number'}.` });
        return null;
      }
      result[key] = number;
    }
    return result;
  }

  app.use(express.json());
  const auth = createAuth(db);
  const publicEvent = event => ({
    ...event,
    passwordProtected: Boolean(db.getEventPasswordHash(event.id))
  });

  app.post('/api/events/:eventId/session', (req, res, next) => {
    auth.login(req, res).catch(next);
  });
  app.delete('/api/events/:eventId/session', auth.logout);

  app.get('/api/events/:eventId/access', (req, res) => {
    const event = db.getEventById(req.params.eventId);
    if (!event) return res.status(404).json({ error: 'Event not found.' });
    res.set('Cache-Control', 'no-store').json({
      passwordProtected: Boolean(db.getEventPasswordHash(event.id)),
      editable: auth.authorized(req, event.id)
    });
  });

  // Guard both event-scoped and legacy writes; hiding controls is not authorization.
  app.use('/api/events/:eventId', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const event = db.getEventById(req.params.eventId);
    if (!event) return res.status(404).json({ error: 'Event not found.' });
    if (!auth.authorized(req, event.id)) {
      return res.status(401).json({ error: 'Unlock this event with its editing password first.' });
    }
    next();
  });
  app.use(['/api/setup', '/api/trebuchets', '/api/shots'], (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const event = db.getEvents()[0];
    if (event && event.measurementMode !== 'angles') {
      return res.status(409).json({ error: 'Use the event-specific endpoints for GPS and compass-bearing events.' });
    }
    if (event && !auth.authorized(req, event.id)) {
      return res.status(401).json({ error: 'Unlock this event with its editing password first.' });
    }
    next();
  });

  // Static files
  app.use(express.static(path.join(__dirname, '../public')));
  app.use('/guide-assets', express.static(path.dirname(require.resolve('katex/dist/katex.min.css'))));
  app.get('/how-it-works/triangulation-diagram.png', (req, res) => {
    res.sendFile(path.join(__dirname, '../docs/triangulation-diagram.png'));
  });
  app.get('/how-it-works', async (req, res, next) => {
    try {
      res.type('html').send(await renderGuide());
    } catch (err) {
      next(err);
    }
  });

  // Favicon fallback handler
  app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
  });

  // Direct URL routing for events: /event/:idOrSlug serves index.html
  app.get('/event/:eventId', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });
  app.get('/event/:eventId/spectator', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });

  // Events API
  app.get('/api/events', (req, res) => {
    try {
      const events = db.getEvents();
      res.json(events.map(publicEvent));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/events', async (req, res) => {
    try {
      const { id, name, baseline, unit, password = '', measurementMode = 'angles' } = req.body || {};
      if (!['angles', 'bearings', 'gps'].includes(measurementMode)) {
        return res.status(400).json({ error: 'Measurement mode must be "gps", "bearings", or "angles".' });
      }
      if (unit !== undefined && unit !== 'ft' && unit !== 'm') {
        return res.status(400).json({ error: 'Unit must be "ft" or "m".' });
      }
      if (typeof password !== 'string' || password.length > 128) {
        return res.status(400).json({ error: 'Password must be text of at most 128 characters.' });
      }
      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (!trimmedName) {
        return res.status(400).json({ error: 'Event name is required.' });
      }
      const passwordHash = password ? await hashPassword(password) : null;

      // Generate slug/id if not provided
      let eventId = typeof id === 'string' && id.trim()
        ? id.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-')
        : trimmedName.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

      if (!eventId) {
        eventId = `event-${Date.now()}`;
      }

      // Ensure uniqueness
      let uniqueId = eventId;
      let counter = 1;
      while (db.getEventById(uniqueId)) {
        uniqueId = `${eventId}-${counter++}`;
      }

      const b = baseline !== undefined && baseline !== null && baseline !== ''
        ? measurementMode === 'bearings' ? measurements.number(baseline, 'Baseline', 0) : parseFloat(baseline) : 0;
      const u = unit === 'm' ? 'm' : 'ft';

      const parseCoord = (val) => {
        if (val === undefined || val === null || val === '') return null;
        const num = parseFloat(val);
        return isNaN(num) ? null : num;
      };

      const created = db.createEvent({
        id: uniqueId,
        measurementMode,
        name: trimmedName,
        baseline: measurementMode === 'gps' || isNaN(b) || b < 0 ? 0 : b,
        unit: u,
        station_a_lat: parseCoord(req.body.station_a_lat ?? req.body.stationALat),
        station_a_lng: parseCoord(req.body.station_a_lng ?? req.body.stationALng),
        station_b_lat: parseCoord(req.body.station_b_lat ?? req.body.stationBLat),
        station_b_lng: parseCoord(req.body.station_b_lng ?? req.body.stationBLng),
        ...(measurementMode !== 'angles' ? measurements.stationGps(measurementMode === 'gps' ? {} : req.body) : {})
      });

      db.setEventPasswordHash(created.id, passwordHash);
      res.status(201).json(publicEvent(created));
    } catch (err) {
      respondError(res, err);
    }
  });

  app.get('/api/events/:eventId', (req, res) => {
    try {
      const event = db.getEventById(req.params.eventId);
      if (!event) {
        return res.status(404).json({ error: 'Event not found.' });
      }
      res.json(publicEvent(event));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/events/:eventId/password', async (req, res) => {
    try {
      const { password } = req.body || {};
      if (typeof password !== 'string' || password.length > 128) {
        return res.status(400).json({ error: 'Password must be text of at most 128 characters.' });
      }
      const hash = password ? await hashPassword(password) : null;
      db.setEventPasswordHash(req.params.eventId, hash);
      res.json({ passwordProtected: Boolean(hash) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/events/:eventId', (req, res) => {
    try {
      const deleted = db.deleteEvent(req.params.eventId);
      if (!deleted) {
        return res.status(404).json({ error: 'Event not found.' });
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Event-scoped Setup endpoints
  app.get('/api/events/:eventId/setup', (req, res) => {
    try {
      const { eventId } = req.params;
      const event = db.getEventById(eventId);
      if (!event) {
        return res.status(404).json({ error: 'Event not found.' });
      }
      const setup = db.getSetup(eventId);
      res.json(setup);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/events/:eventId/setup', (req, res) => {
    try {
      const { eventId } = req.params;
      const event = db.getEventById(eventId);
      if (!event) {
        return res.status(404).json({ error: 'Event not found.' });
      }

      const {
        baseline,
        unit,
        station_a_lat,
        station_a_lng,
        station_b_lat,
        station_b_lng
      } = req.body;
      if (req.body.measurementMode !== undefined && req.body.measurementMode !== event.measurementMode) {
        throw new measurements.MeasurementError('An event’s measurement mode cannot change. Create a new event for a different mode.');
      }

      const b = event.measurementMode === 'gps' ? 0 : measurements.number(baseline, 'Baseline', 0);
      if (event.measurementMode !== 'gps' && b <= 0) {
        return res.status(400).json({ error: 'Baseline must be a positive number.' });
      }
      if (unit !== 'ft' && unit !== 'm') {
        return res.status(400).json({ error: 'Unit must be "ft" or "m".' });
      }
      if (event.measurementMode !== 'angles' && unit !== event.unit && (db.getShots(eventId).length || db.getTrebuchets(eventId).length)) {
        return res.status(400).json({ error: 'Units cannot change after adding trebuchets or shots. Create a separate event to use different units.' });
      }

      const parseCoord = (val) => {
        if (val === undefined || val === null || val === '') return null;
        const num = parseFloat(val);
        return isNaN(num) ? null : num;
      };

      const gps = event.measurementMode !== 'angles' ? measurements.stationGps(event.measurementMode === 'gps' ? {} : req.body) : {
        station_a_lat: parseCoord(req.body.station_a_lat ?? req.body.stationALat),
        station_a_lng: parseCoord(req.body.station_a_lng ?? req.body.stationALng),
        station_b_lat: parseCoord(req.body.station_b_lat ?? req.body.stationBLat),
        station_b_lng: parseCoord(req.body.station_b_lng ?? req.body.stationBLng)
      };
      if (event.measurementMode === 'bearings') {
        gps.referenceA = measurements.bearing(req.body.referenceA, 'Station A bearing toward Station B');
        gps.referenceB = measurements.bearing(req.body.referenceB, 'Station B bearing toward Station A');
        if (req.body.gpsBackup !== undefined && typeof req.body.gpsBackup !== 'boolean') {
          throw new measurements.MeasurementError('GPS backup must be true or false.');
        }
        gps.gpsBackup = req.body.gpsBackup ?? Boolean(event.gpsBackup);
      }

      const updated = db.saveSetup(eventId, b, unit, gps);
      res.json({ ...updated, ...(event.measurementMode === 'bearings'
        ? { warning: measurements.referenceWarning(gps.referenceA, gps.referenceB) } : {}) });
    } catch (err) {
      respondError(res, err);
    }
  });

  // Event-scoped Trebuchets endpoints
  app.get('/api/events/:eventId/trebuchets', (req, res) => {
    try {
      const { eventId } = req.params;
      const event = db.getEventById(eventId);
      if (!event) {
        return res.status(404).json({ error: 'Event not found.' });
      }
      const trebs = db.getTrebuchets(eventId);
      const enriched = trebs.map(t => enrichWithGeo({ ...t }, event, event.unit));
      res.json(enriched);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/events/:eventId/trebuchets', (req, res) => {
    try {
      const { eventId } = req.params;
      const event = db.getEventById(eventId);
      if (!event) {
        return res.status(404).json({ error: 'Event not found.' });
      }

      let { name, dist, angle } = req.body;
      const measurement = {};
      let d = null, a = null;
      if (event.measurementMode === 'gps') {
        measurement.gps = measurements.gps(req.body.gps, 'Trebuchet launch location');
      } else {
        d = measurements.number(dist, 'Distance from Station A', 0);
        if (event.measurementMode === 'bearings') {
          if (event.referenceA == null) throw new measurements.MeasurementError('Save the station reference bearings before surveying a trebuchet.');
          measurement.bearing = measurements.bearing(req.body.bearing, 'Trebuchet bearing from Station A');
          measurement.referenceA = event.referenceA;
          a = bearingDifference(event.referenceA, measurement.bearing);
          measurement.gps = measurements.gps(req.body.gps, 'Trebuchet launch location', false);
        } else {
          a = measurements.number(angle, 'Angle from baseline', -180, 180);
        }
      }

      if (event.measurementMode !== 'gps' && (isNaN(d) || d < 0)) {
        return res.status(400).json({ error: 'Distance from Station A must be a non-negative number.' });
      }
      if (event.measurementMode !== 'gps' && (isNaN(a) || a < -180 || a > 180)) {
        return res.status(400).json({ error: 'Angle from baseline must be between -180 and 180 degrees.' });
      }

      const existing = db.getTrebuchets(eventId);
      const trimmedName = typeof name === 'string' ? name.trim() : '';
      const finalName = trimmedName || `Trebuchet ${existing.length + 1}`;

      const created = db.addTrebuchet(eventId, finalName, d, a, measurement);
      const enriched = enrichWithGeo({ ...created }, event, event.unit);
      res.status(201).json(enriched);
    } catch (err) {
      respondError(res, err);
    }
  });

  app.delete('/api/events/:eventId/trebuchets/:id', (req, res) => {
    try {
      const { eventId } = req.params;
      const id = parseInt(req.params.id, 10);
      const deleted = db.deleteTrebuchet(id, eventId);
      if (!deleted) {
        return res.status(404).json({ error: 'Trebuchet not found.' });
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Event-scoped Shots endpoints
  app.get('/api/events/:eventId/shots', (req, res) => {
    try {
      const { eventId } = req.params;
      const event = db.getEventById(eventId);
      if (!event) {
        return res.status(404).json({ error: 'Event not found.' });
      }
      const shots = db.getShots(eventId);
      const enriched = shots.map(s => enrichWithGeo({ ...s }, event, event.unit));
      res.json(enriched);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/events/:eventId/shots', (req, res) => {
    try {
      const { eventId } = req.params;
      const event = db.getEventById(eventId);
      if (!event) {
        return res.status(404).json({ error: 'Event not found.' });
      }
      const setup = db.getSetup(eventId);
      if (event.measurementMode !== 'gps' && (!setup || !setup.baseline)) {
        return res.status(400).json({ error: 'Save the baseline setup first.' });
      }

      const { label, trebId, angA, angB, known } = req.body;
      const metadata = shotMetadata(req, res, setup);
      if (!metadata) return;
      const parsedAngA = parseFloat(angA);
      const parsedAngB = parseFloat(angB);

      if (event.measurementMode === 'angles' && (isNaN(parsedAngA) || isNaN(parsedAngB))) {
        return res.status(400).json({ error: 'Both angle readings are required numbers.' });
      }

      let treb = null;
      if (trebId !== undefined && trebId !== null && trebId !== '') {
        const id = event.measurementMode === 'angles' ? parseInt(trebId, 10)
          : measurements.number(trebId, 'Trebuchet ID', 1);
        if (!Number.isInteger(id)) throw new measurements.MeasurementError('Select a valid firing trebuchet.');
        treb = db.getTrebuchetById(id, eventId);
        if (!treb) {
          return res.status(400).json({ error: 'Selected trebuchet was not found.' });
        }
      }
      if (event.measurementMode !== 'angles' && !treb) {
        throw new measurements.MeasurementError('Select the firing trebuchet first.');
      }

      const existingShots = db.getShots(eventId);
      const trimmedLabel = typeof label === 'string' ? label.trim() : '';
      const finalLabel = trimmedLabel || `Shot ${existingShots.length + 1}`;

      const parsedKnown = known !== undefined && known !== null && known !== '' ? measurements.number(known, 'Known distance', 0) : null;

      let computed;
      if (event.measurementMode === 'gps') {
        const launchGps = measurements.gps(treb.gps, 'Trebuchet launch location');
        const landingGps = measurements.gps(req.body.landingGps, 'Landing location');
        computed = {
          label: finalLabel, treb: treb.name, known: parsedKnown,
          dist: measurements.gpsDistance(launchGps, landingGps, event.unit),
          measurement: { method: 'gps', unit: event.unit, launchGps, landingGps }
        };
      } else if (event.measurementMode === 'bearings') {
        computed = measurements.compassShot(event, req.body, treb, finalLabel, parsedKnown);
        computed.measurement.launchGps = treb.gps || null;
      } else {
        computed = calculateShot({
          angA: parsedAngA,
          angB: parsedAngB,
          baseline: setup.baseline,
          treb,
          label: finalLabel,
          known: parsedKnown
        });
      }

      if (!computed) {
        return res.status(400).json({
          error: "These two angles don't form a valid triangle (they add to 180° or more). Double-check the readings."
        });
      }

      const created = db.addShot({
        ...metadata,
        eventId,
        label: computed.label,
        treb_id: treb ? treb.id : null,
        treb: computed.treb,
        tx: computed.tx,
        ty: computed.ty,
        angA: computed.angA,
        angB: computed.angB,
        dist: computed.dist,
        check: computed.check,
        px: computed.px,
        py: computed.py,
        known: computed.known,
        measurement: computed.measurement || { method: 'angles', unit: event.unit, baseline: event.baseline }
      });

      const enriched = enrichWithGeo({ ...created }, event, event.unit);
      res.status(201).json(enriched);
    } catch (err) {
      respondError(res, err);
    }
  });

  app.post('/api/events/:eventId/shots/:id/gps-checks', (req, res) => {
    try {
      const event = db.getEventById(req.params.eventId);
      const shot = db.getShotById(Number(req.params.id), event.id);
      if (!shot) return res.status(404).json({ error: 'Shot not found.' });
      if (event.measurementMode !== 'bearings' || !event.gpsBackup || shot.method !== 'bearings') {
        return res.status(400).json({ error: 'Enable GPS checks in the compass event setup first.' });
      }
      const launchGps = measurements.gps(req.body.launchGps ?? shot.launchGps, 'Launch location for this shot');
      const landingGps = measurements.gps(req.body.landingGps, 'Landing location');
      const unit = shot.unit;
      db.addGpsCheck(shot.id, measurements.gpsDistance(launchGps, landingGps, unit), unit, { launchGps, landingGps });
      res.status(201).json(enrichWithGeo(db.getShotById(shot.id, event.id), event, event.unit));
    } catch (err) {
      respondError(res, err);
    }
  });

  app.delete('/api/events/:eventId/shots/:id', (req, res) => {
    try {
      const { eventId } = req.params;
      const id = parseInt(req.params.id, 10);
      const deleted = db.deleteShot(id, eventId);
      if (!deleted) {
        return res.status(404).json({ error: 'Shot not found.' });
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/events/:eventId/shots', (req, res) => {
    try {
      const { eventId } = req.params;
      db.clearShots(eventId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Backward-compatibility endpoints (uses default/first event or 'default')
  function getDefaultEventId() {
    const events = db.getEvents();
    if (events.length > 0) return events[0].id;
    const def = db.createEvent({ id: 'default', name: 'Default Event', baseline: 0, unit: 'ft' });
    return def.id;
  }

  app.get('/api/setup', (req, res) => {
    try {
      const eventId = getDefaultEventId();
      const setup = db.getSetup(eventId);
      res.json(setup);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/setup', (req, res) => {
    try {
      const eventId = getDefaultEventId();
      const { baseline, unit } = req.body;
      const b = parseFloat(baseline);
      if (isNaN(b) || b <= 0) {
        return res.status(400).json({ error: 'Baseline must be a positive number.' });
      }
      if (unit !== 'ft' && unit !== 'm') {
        return res.status(400).json({ error: 'Unit must be "ft" or "m".' });
      }
      const updated = db.saveSetup(eventId, b, unit);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/trebuchets', (req, res) => {
    try {
      const eventId = getDefaultEventId();
      res.json(db.getTrebuchets(eventId));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/trebuchets', (req, res) => {
    try {
      const eventId = getDefaultEventId();
      let { name, dist, angle } = req.body;
      const d = parseFloat(dist);
      const a = parseFloat(angle);
      if (isNaN(d) || d < 0) {
        return res.status(400).json({ error: 'Distance from Station A must be a non-negative number.' });
      }
      if (isNaN(a) || a < -180 || a > 180) {
        return res.status(400).json({ error: 'Angle from baseline must be between -180 and 180 degrees.' });
      }
      const existing = db.getTrebuchets(eventId);
      const trimmedName = typeof name === 'string' ? name.trim() : '';
      const finalName = trimmedName || `Trebuchet ${existing.length + 1}`;
      const created = db.addTrebuchet(eventId, finalName, d, a);
      res.status(201).json(created);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/trebuchets/:id', (req, res) => {
    try {
      const eventId = getDefaultEventId();
      const id = parseInt(req.params.id, 10);
      const deleted = db.deleteTrebuchet(id, eventId);
      if (!deleted) {
        return res.status(404).json({ error: 'Trebuchet not found.' });
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/shots', (req, res) => {
    try {
      const eventId = getDefaultEventId();
      res.json(db.getShots(eventId));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/shots', (req, res) => {
    try {
      const eventId = getDefaultEventId();
      const setup = db.getSetup(eventId);
      if (!setup || !setup.baseline) {
        return res.status(400).json({ error: 'Save the baseline setup first.' });
      }

      const { label, trebId, angA, angB, known } = req.body;
      const metadata = shotMetadata(req, res, setup);
      if (!metadata) return;
      const parsedAngA = parseFloat(angA);
      const parsedAngB = parseFloat(angB);

      if (isNaN(parsedAngA) || isNaN(parsedAngB)) {
        return res.status(400).json({ error: 'Both angle readings are required numbers.' });
      }

      let treb = null;
      if (trebId !== undefined && trebId !== null && trebId !== '') {
        treb = db.getTrebuchetById(parseInt(trebId, 10), eventId);
        if (!treb) {
          return res.status(400).json({ error: 'Selected trebuchet was not found.' });
        }
      }

      const existingShots = db.getShots(eventId);
      const trimmedLabel = typeof label === 'string' ? label.trim() : '';
      const finalLabel = trimmedLabel || `Shot ${existingShots.length + 1}`;
      const parsedKnown = known !== undefined && known !== null && known !== '' ? parseFloat(known) : null;

      const computed = calculateShot({
        angA: parsedAngA,
        angB: parsedAngB,
        baseline: setup.baseline,
        treb,
        label: finalLabel,
        known: parsedKnown
      });

      if (!computed) {
        return res.status(400).json({
          error: "These two angles don't form a valid triangle (they add to 180° or more). Double-check the readings."
        });
      }

      const created = db.addShot({
        ...metadata,
        eventId,
        label: computed.label,
        treb_id: treb ? treb.id : null,
        treb: computed.treb,
        tx: computed.tx,
        ty: computed.ty,
        angA: computed.angA,
        angB: computed.angB,
        dist: computed.dist,
        check: computed.check,
        px: computed.px,
        py: computed.py,
        known: computed.known
      });

      res.status(201).json(created);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/shots/:id', (req, res) => {
    try {
      const eventId = getDefaultEventId();
      const id = parseInt(req.params.id, 10);
      const deleted = db.deleteShot(id, eventId);
      if (!deleted) {
        return res.status(404).json({ error: 'Shot not found.' });
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/shots', (req, res) => {
    try {
      const eventId = getDefaultEventId();
      db.clearShots(eventId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    console.error('Request failed:', err.message);
    res.status(err.status || 500).json({ error: 'Unable to process the request.' });
  });

  return app;
}

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const db = createDb();
  const app = createApp(db);

  app.listen(PORT, () => {
    console.log(`Impact Distance Tracker running at http://localhost:${PORT}`);
  });
}

module.exports = { createApp };
