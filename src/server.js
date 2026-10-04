const express = require('express');
const path = require('path');
const { createDb } = require('./db');
const { calculateShot, calculateBearing, localXYToLatLng } = require('./math');
const { hashPassword, createAuth } = require('./auth');
const { renderGuide } = require('./guide');

function enrichWithGeo(point, event, unit) {
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

  // If point has tx, ty (e.g. shot launcher location)
  if (typeof point.tx === 'number' && typeof point.ty === 'number') {
    const geo = localXYToLatLng(point.tx, point.ty, event.station_a_lat, event.station_a_lng, bearingAB, unit);
    point.treb_geo = geo;
    point.trebGeo = geo;
  }
  // If point has px, py (e.g. shot splash location)
  if (typeof point.px === 'number' && typeof point.py === 'number') {
    const geo = localXYToLatLng(point.px, point.py, event.station_a_lat, event.station_a_lng, bearingAB, unit);
    point.splash_geo = geo;
    point.splashGeo = geo;
  }
  // If point has dist and angle (e.g. trebuchet definition)
  if (typeof point.dist === 'number' && typeof point.angle === 'number') {
    const rad = (point.angle * Math.PI) / 180;
    const x = point.dist * Math.cos(rad);
    const y = point.dist * Math.sin(rad);
    point.geo = localXYToLatLng(x, y, event.station_a_lat, event.station_a_lng, bearingAB, unit);
  }

  return point;
}

function createApp(db) {
  const app = express();

  app.use(express.json());
  const auth = createAuth(db);
  const publicEvent = event => ({
    ...event,
    passwordProtected: Boolean(db.getEventPasswordHash(event.id))
  });

  app.post('/api/events/:eventId/session', (req, res, next) => {
    auth.login(req, res).catch(next);
  });

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
      const { id, name, baseline, unit, password = '' } = req.body || {};
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

      const b = baseline !== undefined && baseline !== null && baseline !== '' ? parseFloat(baseline) : 0;
      const u = unit === 'm' ? 'm' : 'ft';

      const parseCoord = (val) => {
        if (val === undefined || val === null || val === '') return null;
        const num = parseFloat(val);
        return isNaN(num) ? null : num;
      };

      const created = db.createEvent({
        id: uniqueId,
        name: trimmedName,
        baseline: isNaN(b) || b < 0 ? 0 : b,
        unit: u,
        station_a_lat: parseCoord(req.body.station_a_lat ?? req.body.stationALat),
        station_a_lng: parseCoord(req.body.station_a_lng ?? req.body.stationALng),
        station_b_lat: parseCoord(req.body.station_b_lat ?? req.body.stationBLat),
        station_b_lng: parseCoord(req.body.station_b_lng ?? req.body.stationBLng)
      });

      db.setEventPasswordHash(created.id, passwordHash);
      res.status(201).json(publicEvent(created));
    } catch (err) {
      res.status(500).json({ error: err.message });
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

      const b = parseFloat(baseline);
      if (isNaN(b) || b <= 0) {
        return res.status(400).json({ error: 'Baseline must be a positive number.' });
      }
      if (unit !== 'ft' && unit !== 'm') {
        return res.status(400).json({ error: 'Unit must be "ft" or "m".' });
      }

      const parseCoord = (val) => {
        if (val === undefined || val === null || val === '') return null;
        const num = parseFloat(val);
        return isNaN(num) ? null : num;
      };

      const gps = {
        station_a_lat: parseCoord(req.body.station_a_lat ?? req.body.stationALat),
        station_a_lng: parseCoord(req.body.station_a_lng ?? req.body.stationALng),
        station_b_lat: parseCoord(req.body.station_b_lat ?? req.body.stationBLat),
        station_b_lng: parseCoord(req.body.station_b_lng ?? req.body.stationBLng)
      };

      const updated = db.saveSetup(eventId, b, unit, gps);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
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
      const enriched = enrichWithGeo({ ...created }, event, event.unit);
      res.status(201).json(enriched);
    } catch (err) {
      res.status(500).json({ error: err.message });
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
      if (!setup || !setup.baseline) {
        return res.status(400).json({ error: 'Save the baseline setup first.' });
      }

      const { label, trebId, angA, angB, known } = req.body;
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

      const enriched = enrichWithGeo({ ...created }, event, event.unit);
      res.status(201).json(enriched);
    } catch (err) {
      res.status(500).json({ error: err.message });
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
    console.log(`Splash Distance Tracker running at http://localhost:${PORT}`);
  });
}

module.exports = { createApp };
