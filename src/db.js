const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

function createDb(dbPath = process.env.DB_PATH || path.join(__dirname, '../data/tracker.db')) {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);

  // Enable WAL mode for better concurrency in persistent databases
  if (dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  db.pragma('foreign_keys = ON');

  // Schema creation
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      baseline REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'ft' CHECK (unit IN ('ft', 'm')),
      is_configured INTEGER NOT NULL DEFAULT 0,
      station_a_lat REAL,
      station_a_lng REAL,
      station_b_lat REAL,
      station_b_lng REAL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trebuchets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      name TEXT NOT NULL,
      dist REAL NOT NULL,
      angle REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      label TEXT NOT NULL,
      treb_id INTEGER,
      treb TEXT NOT NULL,
      tx REAL NOT NULL,
      ty REAL NOT NULL,
      angA REAL NOT NULL,
      angB REAL NOT NULL,
      dist REAL NOT NULL,
      check_dist REAL NOT NULL,
      px REAL NOT NULL,
      py REAL NOT NULL,
      known REAL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE,
      FOREIGN KEY (treb_id) REFERENCES trebuchets (id) ON DELETE SET NULL
    );
  `);

  const DEFAULT_EVENT_ID = 'default';

  function ensureDefaultEvent() {
    const existing = db.prepare('SELECT id FROM events WHERE id = ?').get(DEFAULT_EVENT_ID);
    if (!existing) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO events (id, name, baseline, unit, is_configured, created_at, updated_at)
        VALUES ('default', 'Default Event', 0, 'ft', 0, datetime('now'), datetime('now'))
      `);
      stmt.run();
    }
  }

  // Schema migrations for pre-existing databases created before multi-event support
  function runMigrations() {
    // Migrate trebuchets table if event_id column is missing
    const trebColumns = db.prepare('PRAGMA table_info(trebuchets)').all();
    const hasTrebEventId = trebColumns.some(c => c.name === 'event_id');
    if (!hasTrebEventId) {
      ensureDefaultEvent();
      db.prepare(`ALTER TABLE trebuchets ADD COLUMN event_id TEXT NOT NULL DEFAULT '${DEFAULT_EVENT_ID}'`).run();
    }

    // Migrate shots table if event_id column is missing
    const shotColumns = db.prepare('PRAGMA table_info(shots)').all();
    const hasShotEventId = shotColumns.some(c => c.name === 'event_id');
    if (!hasShotEventId) {
      ensureDefaultEvent();
      db.prepare(`ALTER TABLE shots ADD COLUMN event_id TEXT NOT NULL DEFAULT '${DEFAULT_EVENT_ID}'`).run();
    }

    // Migrate events table if GPS coordinate columns are missing
    const eventColumns = db.prepare('PRAGMA table_info(events)').all();
    if (!eventColumns.some(c => c.name === 'password_hash')) {
      db.prepare('ALTER TABLE events ADD COLUMN password_hash TEXT').run();
    }
    if (!eventColumns.some(c => c.name === 'station_a_lat')) {
      db.prepare('ALTER TABLE events ADD COLUMN station_a_lat REAL').run();
    }
    if (!eventColumns.some(c => c.name === 'station_a_lng')) {
      db.prepare('ALTER TABLE events ADD COLUMN station_a_lng REAL').run();
    }
    if (!eventColumns.some(c => c.name === 'station_b_lat')) {
      db.prepare('ALTER TABLE events ADD COLUMN station_b_lat REAL').run();
    }
    if (!eventColumns.some(c => c.name === 'station_b_lng')) {
      db.prepare('ALTER TABLE events ADD COLUMN station_b_lng REAL').run();
    }
  }

  runMigrations();

  return {
    raw: db,

    getEventPasswordHash(id) {
      return db.prepare('SELECT password_hash FROM events WHERE id = ?').get(id)?.password_hash || null;
    },

    setEventPasswordHash(id, hash) {
      db.prepare('UPDATE events SET password_hash = ? WHERE id = ?').run(hash, id);
    },

    // Events
    getEvents() {
      const stmt = db.prepare('SELECT id, name, baseline, unit, is_configured, station_a_lat, station_a_lng, station_b_lat, station_b_lng, created_at, updated_at FROM events ORDER BY created_at DESC');
      return stmt.all();
    },

    getEventById(id) {
      const stmt = db.prepare('SELECT id, name, baseline, unit, is_configured, station_a_lat, station_a_lng, station_b_lat, station_b_lng, created_at, updated_at FROM events WHERE id = ?');
      return stmt.get(id) || null;
    },

    createEvent({ id, name, baseline = 0, unit = 'ft', station_a_lat = null, station_a_lng = null, station_b_lat = null, station_b_lng = null } = {}) {
      if (typeof arguments[0] === 'string') {
        // Support signature createEvent(name, baseline, unit)
        const evName = arguments[0];
        const evBase = arguments[1] !== undefined ? arguments[1] : 0;
        const evUnit = arguments[2] || 'ft';
        const genId = evName.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || `event-${Date.now()}`;
        return this.createEvent({ id: genId, name: evName, baseline: evBase, unit: evUnit });
      }
      const isConfigured = baseline > 0 ? 1 : 0;
      const stmt = db.prepare(`
        INSERT INTO events (id, name, baseline, unit, is_configured, station_a_lat, station_a_lng, station_b_lat, station_b_lng, created_at, updated_at)
        VALUES (@id, @name, @baseline, @unit, @isConfigured, @station_a_lat, @station_a_lng, @station_b_lat, @station_b_lng, datetime('now'), datetime('now'))
      `);
      stmt.run({
        id,
        name,
        baseline: baseline || 0,
        unit: unit || 'ft',
        isConfigured,
        station_a_lat: station_a_lat !== undefined ? station_a_lat : null,
        station_a_lng: station_a_lng !== undefined ? station_a_lng : null,
        station_b_lat: station_b_lat !== undefined ? station_b_lat : null,
        station_b_lng: station_b_lng !== undefined ? station_b_lng : null
      });
      return this.getEventById(id);
    },

    deleteEvent(id) {
      const stmt = db.prepare('DELETE FROM events WHERE id = ?');
      const info = stmt.run(id);
      return info.changes > 0;
    },

    // Setup for a specific event
    getSetup(eventId = DEFAULT_EVENT_ID) {
      const ev = this.getEventById(eventId);
      if (!ev) return null;
      if (ev.baseline === 0 && !ev.is_configured && ev.station_a_lat === null) {
        return null;
      }
      return {
        baseline: ev.baseline,
        unit: ev.unit,
        station_a_lat: ev.station_a_lat,
        station_a_lng: ev.station_a_lng,
        station_b_lat: ev.station_b_lat,
        station_b_lng: ev.station_b_lng
      };
    },

    saveSetup(eventId, baseline, unit, gps = {}) {
      // Support legacy signature saveSetup(baseline, unit)
      if (typeof baseline === 'string' && (unit === undefined || unit === null)) {
        unit = baseline;
        baseline = eventId;
        eventId = DEFAULT_EVENT_ID;
      } else if (unit === undefined) {
        unit = 'ft';
      }
      if (eventId === DEFAULT_EVENT_ID) {
        ensureDefaultEvent();
      }

      const {
        station_a_lat = null,
        station_a_lng = null,
        station_b_lat = null,
        station_b_lng = null
      } = gps || {};

      const current = this.getEventById(eventId);
      const new_a_lat = station_a_lat !== undefined ? station_a_lat : (current ? current.station_a_lat : null);
      const new_a_lng = station_a_lng !== undefined ? station_a_lng : (current ? current.station_a_lng : null);
      const new_b_lat = station_b_lat !== undefined ? station_b_lat : (current ? current.station_b_lat : null);
      const new_b_lng = station_b_lng !== undefined ? station_b_lng : (current ? current.station_b_lng : null);

      const stmt = db.prepare(`
        UPDATE events
        SET baseline = @baseline, unit = @unit, is_configured = 1,
            station_a_lat = @station_a_lat, station_a_lng = @station_a_lng,
            station_b_lat = @station_b_lat, station_b_lng = @station_b_lng,
            updated_at = datetime('now')
        WHERE id = @id
      `);
      stmt.run({
        id: eventId,
        baseline,
        unit,
        station_a_lat: new_a_lat,
        station_a_lng: new_a_lng,
        station_b_lat: new_b_lat,
        station_b_lng: new_b_lng
      });
      return this.getSetup(eventId);
    },

    // Trebuchets scoped to event
    getTrebuchets(eventId = DEFAULT_EVENT_ID) {
      const stmt = db.prepare('SELECT id, event_id, name, dist, angle FROM trebuchets WHERE event_id = ? ORDER BY id ASC');
      return stmt.all(eventId);
    },

    getTrebuchetById(id, eventId = null) {
      let query = 'SELECT id, event_id, name, dist, angle FROM trebuchets WHERE id = ?';
      const params = [id];
      if (eventId) {
        query += ' AND event_id = ?';
        params.push(eventId);
      }
      const stmt = db.prepare(query);
      return stmt.get(...params) || null;
    },

    addTrebuchet(eventId, name, dist, angle) {
      // Support legacy signature addTrebuchet(name, dist, angle)
      if (typeof angle === 'undefined') {
        angle = dist;
        dist = name;
        name = eventId;
        eventId = DEFAULT_EVENT_ID;
      }
      if (eventId === DEFAULT_EVENT_ID) {
        ensureDefaultEvent();
      }
      const stmt = db.prepare(`
        INSERT INTO trebuchets (event_id, name, dist, angle)
        VALUES (@eventId, @name, @dist, @angle)
      `);
      const info = stmt.run({ eventId, name, dist, angle });
      return this.getTrebuchetById(info.lastInsertRowid);
    },

    deleteTrebuchet(id, eventId = null) {
      let query = 'DELETE FROM trebuchets WHERE id = ?';
      const params = [id];
      if (eventId) {
        query += ' AND event_id = ?';
        params.push(eventId);
      }
      const stmt = db.prepare(query);
      const info = stmt.run(...params);
      return info.changes > 0;
    },

    // Shots scoped to event
    getShots(eventId = DEFAULT_EVENT_ID) {
      const stmt = db.prepare(`
        SELECT id, event_id, label, treb_id, treb, tx, ty, angA, angB, dist, check_dist as "check", px, py, known, created_at
        FROM shots
        WHERE event_id = ?
        ORDER BY id ASC
      `);
      return stmt.all(eventId);
    },

    getShotById(id, eventId = null) {
      let query = `
        SELECT id, event_id, label, treb_id, treb, tx, ty, angA, angB, dist, check_dist as "check", px, py, known, created_at
        FROM shots
        WHERE id = ?
      `;
      const params = [id];
      if (eventId) {
        query += ' AND event_id = ?';
        params.push(eventId);
      }
      const stmt = db.prepare(query);
      return stmt.get(...params) || null;
    },

    addShot({ eventId = DEFAULT_EVENT_ID, label, treb_id, treb, tx, ty, angA, angB, dist, check, px, py, known }) {
      if (eventId === DEFAULT_EVENT_ID) {
        ensureDefaultEvent();
      }
      const stmt = db.prepare(`
        INSERT INTO shots (event_id, label, treb_id, treb, tx, ty, angA, angB, dist, check_dist, px, py, known)
        VALUES (@eventId, @label, @treb_id, @treb, @tx, @ty, @angA, @angB, @dist, @check, @px, @py, @known)
      `);
      const info = stmt.run({
        eventId,
        label,
        treb_id: treb_id || null,
        treb,
        tx,
        ty,
        angA,
        angB,
        dist,
        check,
        px,
        py,
        known: known ?? null
      });
      return this.getShotById(info.lastInsertRowid);
    },

    deleteShot(id, eventId = null) {
      let query = 'DELETE FROM shots WHERE id = ?';
      const params = [id];
      if (eventId) {
        query += ' AND event_id = ?';
        params.push(eventId);
      }
      const stmt = db.prepare(query);
      const info = stmt.run(...params);
      return info.changes > 0;
    },

    clearShots(eventId = DEFAULT_EVENT_ID) {
      const stmt = db.prepare('DELETE FROM shots WHERE event_id = ?');
      stmt.run(eventId);
      return true;
    },

    close() {
      db.close();
    }
  };
}

module.exports = { createDb };
