const express = require('express');
const path = require('path');
const { createDb } = require('./db');
const { calculateShot } = require('./math');

function createApp(db) {
  const app = express();

  app.use(express.json());

  // Static files
  app.use(express.static(path.join(__dirname, '../public')));

  // Favicon fallback handler
  app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
  });

  // Direct URL routing for events: /event/:idOrSlug serves index.html
  app.get('/event/:eventId', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });

  // Events API
  app.get('/api/events', (req, res) => {
    try {
      const events = db.getEvents();
      res.json(events);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/events', (req, res) => {
    try {
      const { id, name, baseline, unit } = req.body;
      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (!trimmedName) {
        return res.status(400).json({ error: 'Event name is required.' });
      }

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

      const created = db.createEvent({
        id: uniqueId,
        name: trimmedName,
        baseline: isNaN(b) || b < 0 ? 0 : b,
        unit: u
      });

      res.status(201).json(created);
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
      res.json(event);
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

  // Event-scoped Trebuchets endpoints
  app.get('/api/events/:eventId/trebuchets', (req, res) => {
    try {
      const { eventId } = req.params;
      if (!db.getEventById(eventId)) {
        return res.status(404).json({ error: 'Event not found.' });
      }
      const trebs = db.getTrebuchets(eventId);
      res.json(trebs);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/events/:eventId/trebuchets', (req, res) => {
    try {
      const { eventId } = req.params;
      if (!db.getEventById(eventId)) {
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
      res.status(201).json(created);
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
      if (!db.getEventById(eventId)) {
        return res.status(404).json({ error: 'Event not found.' });
      }
      const shots = db.getShots(eventId);
      res.json(shots);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/events/:eventId/shots', (req, res) => {
    try {
      const { eventId } = req.params;
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
