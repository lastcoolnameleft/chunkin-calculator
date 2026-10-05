const { randomBytes, scrypt, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');

const deriveKey = promisify(scrypt);

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await deriveKey(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}

async function verifyPassword(password, hash) {
  const [salt, hex] = hash.split(':');
  const key = await deriveKey(password, salt, 64);
  return timingSafeEqual(key, Buffer.from(hex, 'hex'));
}

function createAuth(db) {
  const attempts = new Map();
  const tokenHash = req => createHash('sha256')
    .update((req.get('Authorization') || '').replace(/^Bearer /, '')).digest('hex');

  function prune() {
    const now = Date.now();
    for (const [key, value] of attempts) {
      if (value.expires <= now) attempts.delete(key);
    }
  }

  function authorized(req, eventId) {
    const hash = db.getEventPasswordHash(eventId);
    if (!hash) return true;
    return db.hasEditingSession(eventId, tokenHash(req));
  }

  async function login(req, res) {
    const eventId = req.params.eventId;
    if (!db.getEventById(eventId)) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    prune();
    const key = `${req.ip}:${eventId}`;
    const attempt = attempts.get(key) || { count: 0, expires: Date.now() + 15 * 60 * 1000 };
    if (attempt.count >= 10 || attempts.size >= 10000) {
      return res.status(429).json({ error: 'Too many unlock attempts. Please try again later.' });
    }
    attempt.count++;
    attempts.set(key, attempt);
    const hash = db.getEventPasswordHash(eventId);
    const password = req.body?.password;
    if (hash && (typeof password !== 'string' || password.length > 128 ||
      !await verifyPassword(password, hash))) {
      return res.status(401).json({ error: 'Incorrect event password.' });
    }
    attempts.delete(key);
    const token = randomBytes(32).toString('hex');
    // A password change during scrypt verification must not grant access with the old password.
    if (db.getEventPasswordHash(eventId) !== hash) {
      return res.status(401).json({ error: 'Event password changed. Please try again.' });
    }
    db.saveEditingSession(eventId, createHash('sha256').update(token).digest('hex'));
    res.set('Cache-Control', 'no-store').json({ token });
  }

  function logout(req, res) {
    db.deleteEditingSession(req.params.eventId, tokenHash(req));
    res.json({ success: true });
  }

  return { authorized, login, logout };
}

module.exports = { hashPassword, createAuth };
