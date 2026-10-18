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
      dist REAL,
      angle REAL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      label TEXT NOT NULL,
      treb_id INTEGER,
      treb TEXT NOT NULL,
      tx REAL,
      ty REAL,
      angA REAL,
      angB REAL,
      dist REAL NOT NULL,
      check_dist REAL,
      px REAL,
      py REAL,
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
    for (const column of ['ballisticWeight', 'counterweight', 'fingerAngle']) {
      if (!shotColumns.some(c => c.name === column)) db.exec(`ALTER TABLE shots ADD COLUMN ${column} REAL`);
    }
    if (!shotColumns.some(c => c.name === 'weightUnit')) {
      db.exec("ALTER TABLE shots ADD COLUMN weightUnit TEXT CHECK (weightUnit IN ('lb', 'kg'))");
    }
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
  db.transaction(() => {
    for (const table of ['events', 'trebuchets', 'shots']) {
      if (!db.pragma(`table_info(${table})`).some(column => column.name === 'measurement_data')) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN measurement_data TEXT NOT NULL DEFAULT '{}'`);
      }
    }
    if (!db.pragma('table_info(events)').some(column => column.name === 'measurement_mode')) {
      db.exec("ALTER TABLE events ADD COLUMN measurement_mode TEXT NOT NULL DEFAULT 'angles' CHECK (measurement_mode IN ('angles', 'bearings', 'gps'))");
    }
  })();

  // GPS records have no triangle angles or local station coordinates.
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      for (const [table, nullable] of [
        ['trebuchets', ['dist', 'angle']],
        ['shots', ['tx', 'ty', 'angA', 'angB', 'check_dist', 'px', 'py']]
      ]) {
        if (!db.pragma(`table_info(${table})`).some(column => nullable.includes(column.name) && column.notnull)) continue;
        const original = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table).sql;
        const sequence = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(table)?.seq;
        const dependentSchema = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name = ? AND type IN ('index', 'trigger') AND sql IS NOT NULL").all(table);
        let schema = original.replace(new RegExp(`^(CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?)"?${table}"?`, 'i'), `$1${table}_measurement_migration`);
        for (const column of nullable) {
          schema = schema.replace(new RegExp(`("?${column}"?\\s+REAL)\\s+NOT\\s+NULL`, 'i'), '$1');
        }
        db.exec(schema);
        db.exec(`INSERT INTO ${table}_measurement_migration SELECT * FROM ${table};
          DROP TABLE ${table};
          ALTER TABLE ${table}_measurement_migration RENAME TO ${table};`);
        for (const object of dependentSchema) db.exec(object.sql);
        if (sequence !== undefined) {
          db.prepare('UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?').run(sequence, table);
        }
      }
      if (db.pragma('foreign_key_check').length) throw new Error('Measurement migration failed foreign key validation.');
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS editing_sessions (
      token_hash TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS gps_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shot_id INTEGER NOT NULL,
      dist REAL NOT NULL,
      unit TEXT NOT NULL CHECK (unit IN ('ft', 'm')),
      measurement_data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (shot_id) REFERENCES shots (id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS gps_checks_shot_id ON gps_checks (shot_id);
  `);

  function decode(row) {
    if (!row) return null;
    const { measurement_data, ...fields } = row;
    return { ...fields, ...JSON.parse(measurement_data || '{}') };
  }
  const eventFields = 'id, name, baseline, unit, is_configured, station_a_lat, station_a_lng, station_b_lat, station_b_lng, created_at, updated_at, measurement_mode AS measurementMode, measurement_data';
  const trebFields = 'id, event_id, name, dist, angle, measurement_data';
  const shotFields = 'id, event_id, label, treb_id, treb, tx, ty, angA, angB, dist, check_dist AS "check", px, py, known, ballisticWeight, counterweight, fingerAngle, weightUnit, created_at, measurement_data';
  function decodeShot(row) {
    if (!row) return null;
    return {
      ...decode(row),
      gpsChecks: db.prepare('SELECT id, dist, unit, measurement_data, created_at FROM gps_checks WHERE shot_id = ? ORDER BY id').all(row.id).map(decode)
    };
  }

  return {
    raw: db,

    getEventPasswordHash(id) {
      return db.prepare('SELECT password_hash FROM events WHERE id = ?').get(id)?.password_hash || null;
    },

    setEventPasswordHash(id, hash) {
      db.transaction(() => {
        db.prepare('DELETE FROM editing_sessions WHERE event_id = ?').run(id);
        db.prepare('UPDATE events SET password_hash = ? WHERE id = ?').run(hash, id);
      })();
    },

    saveEditingSession(eventId, tokenHash) {
      db.prepare('INSERT INTO editing_sessions (event_id, token_hash) VALUES (?, ?)').run(eventId, tokenHash);
    },

    hasEditingSession(eventId, tokenHash) {
      return Boolean(db.prepare('SELECT 1 FROM editing_sessions WHERE event_id = ? AND token_hash = ?').get(eventId, tokenHash));
    },

    deleteEditingSession(eventId, tokenHash) {
      db.prepare('DELETE FROM editing_sessions WHERE event_id = ? AND token_hash = ?').run(eventId, tokenHash);
    },

    // Events
    getEvents() {
      return db.prepare(`SELECT ${eventFields} FROM events ORDER BY created_at DESC`).all().map(decode);
    },

    getEventById(id) {
      return decode(db.prepare(`SELECT ${eventFields} FROM events WHERE id = ?`).get(id));
    },

    createEvent({ id, name, baseline = 0, unit = 'ft', station_a_lat = null, station_a_lng = null, station_b_lat = null, station_b_lng = null, measurementMode = 'angles' } = {}) {
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
        INSERT INTO events (id, name, baseline, unit, is_configured, station_a_lat, station_a_lng, station_b_lat, station_b_lng, measurement_mode, created_at, updated_at)
        VALUES (@id, @name, @baseline, @unit, @isConfigured, @station_a_lat, @station_a_lng, @station_b_lat, @station_b_lng, @measurementMode, datetime('now'), datetime('now'))
      `);
      stmt.run({
        id,
        name,
        baseline: baseline || 0,
        unit: unit || 'ft',
        isConfigured,
        measurementMode,
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
      if (ev.measurementMode === 'angles' && ev.baseline === 0 && !ev.is_configured && ev.station_a_lat === null) {
        return null;
      }
      return {
        ...(ev.measurementMode === 'angles' ? {} : {
          measurementMode: ev.measurementMode,
          referenceA: ev.referenceA ?? null, referenceB: ev.referenceB ?? null,
          gpsBackup: Boolean(ev.gpsBackup)
        }),
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
            measurement_data = @measurement_data, updated_at = datetime('now')
        WHERE id = @id
      `);
      stmt.run({
        id: eventId,
        baseline,
        unit,
        measurement_data: JSON.stringify({
          referenceA: gps.referenceA ?? current?.referenceA ?? null,
          referenceB: gps.referenceB ?? current?.referenceB ?? null,
          gpsBackup: gps.gpsBackup ?? current?.gpsBackup ?? false
        }),
        station_a_lat: new_a_lat,
        station_a_lng: new_a_lng,
        station_b_lat: new_b_lat,
        station_b_lng: new_b_lng
      });
      return this.getSetup(eventId);
    },

    // Trebuchets scoped to event
    getTrebuchets(eventId = DEFAULT_EVENT_ID) {
      return db.prepare(`SELECT ${trebFields} FROM trebuchets WHERE event_id = ? ORDER BY id ASC`).all(eventId).map(decode);
    },

    getTrebuchetById(id, eventId = null) {
      let query = `SELECT ${trebFields} FROM trebuchets WHERE id = ?`;
      const params = [id];
      if (eventId) {
        query += ' AND event_id = ?';
        params.push(eventId);
      }
      const stmt = db.prepare(query);
      return decode(stmt.get(...params));
    },

    addTrebuchet(eventId, name, dist, angle, measurement = {}) {
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
        INSERT INTO trebuchets (event_id, name, dist, angle, measurement_data)
        VALUES (@eventId, @name, @dist, @angle, @measurement_data)
      `);
      const info = stmt.run({ eventId, name, dist, angle, measurement_data: JSON.stringify(measurement) });
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
        SELECT ${shotFields}
        FROM shots
        WHERE event_id = ?
        ORDER BY id ASC
      `);
      return stmt.all(eventId).map(decodeShot);
    },

    getShotById(id, eventId = null) {
      let query = `
        SELECT ${shotFields}
        FROM shots
        WHERE id = ?
      `;
      const params = [id];
      if (eventId) {
        query += ' AND event_id = ?';
        params.push(eventId);
      }
      const stmt = db.prepare(query);
      return decodeShot(stmt.get(...params));
    },

    addShot({ eventId = DEFAULT_EVENT_ID, label, treb_id, treb, tx = null, ty = null, angA = null, angB = null, dist, check = null, px = null, py = null, known, ballisticWeight = null, counterweight = null, fingerAngle = null, weightUnit = null, measurement = {} }) {
      if (eventId === DEFAULT_EVENT_ID) {
        ensureDefaultEvent();
      }
      const stmt = db.prepare(`
        INSERT INTO shots (event_id, label, treb_id, treb, tx, ty, angA, angB, dist, check_dist, px, py, known, ballisticWeight, counterweight, fingerAngle, weightUnit, measurement_data)
        VALUES (@eventId, @label, @treb_id, @treb, @tx, @ty, @angA, @angB, @dist, @check, @px, @py, @known, @ballisticWeight, @counterweight, @fingerAngle, @weightUnit, @measurement_data)
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
        known: known ?? null,
        ballisticWeight, counterweight, fingerAngle, weightUnit,
        measurement_data: JSON.stringify(measurement)
      });
      return this.getShotById(info.lastInsertRowid);
    },

    addGpsCheck(shotId, distance, unit, measurement) {
      db.prepare('INSERT INTO gps_checks (shot_id, dist, unit, measurement_data) VALUES (?, ?, ?, ?)')
        .run(shotId, distance, unit, JSON.stringify(measurement));
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
