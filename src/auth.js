const { randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
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
  const sessions = new Map();
  const attempts = new Map();
  const lifetime = 12 * 60 * 60 * 1000;

  function prune() {
    const now = Date.now();
    for (const [key, value] of sessions) {
      if (value.expires <= now) sessions.delete(key);
    }
    for (const [key, value] of attempts) {
      if (value.expires <= now) attempts.delete(key);
    }
  }

  function authorized(req, eventId) {
    const hash = db.getEventPasswordHash(eventId);
    if (!hash) return true;
    const token = (req.get('Authorization') || '').replace(/^Bearer /, '');
    const session = sessions.get(token);
    return Boolean(session && session.eventId === eventId &&
      session.expires > Date.now() && session.hash === hash);
  }

  async function login(req, res) {
    const eventId = req.params.eventId;
    if (!db.getEventById(eventId)) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    prune();
    const key = `${req.ip}:${eventId}`;
    const attempt = attempts.get(key) || { count: 0, expires: Date.now() + 15 * 60 * 1000 };
    if (attempt.count >= 10 || attempts.size >= 10000 || sessions.size >= 10000) {
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
    sessions.set(token, { eventId, hash, expires: Date.now() + lifetime });
    res.set('Cache-Control', 'no-store').json({ token });
  }

  return { authorized, login };
}

module.exports = { hashPassword, createAuth };
