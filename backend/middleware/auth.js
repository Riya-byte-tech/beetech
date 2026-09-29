const db = require('../db/db');
const { verifyToken, TokenError } = require('../services/auth');

const COOKIE_NAME = 'honeychain_session';

/**
 * Minimal cookie parser (avoids adding the `cookie-parser` dependency for
 * something this small). `req.headers.cookie` looks like "a=1; b=2".
 */
function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return header.split(';').reduce((acc, pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return acc;
    const key = pair.slice(0, idx).trim();
    const value = decodeURIComponent(pair.slice(idx + 1).trim());
    acc[key] = value;
    return acc;
  }, {});
}

/**
 * Requires a valid session cookie. Attaches `req.user = { id, email, role,
 * beekeeper_id }` on success. Every route except /api/auth/* and the public
 * /api/verify/* consumer endpoints sits behind this.
 */
function requireAuth(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];

  if (!token) {
    return res.status(401).json({ error: 'Not logged in.' });
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    if (err instanceof TokenError) {
      return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
    }
    throw err;
  }

  const user = db.prepare('SELECT id, email, role, beekeeper_id FROM users WHERE id = ?').get(payload.userId);
  if (!user) {
    return res.status(401).json({ error: 'Account no longer exists.' });
  }

  req.user = user;
  next();
}

/** Use after requireAuth. Usage: requireRole('lab', 'admin') */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not logged in.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `This action requires one of these roles: ${allowedRoles.join(', ')}.` });
    }
    next();
  };
}

/**
 * Use after requireRole('beekeeper'). Blocks harvest/batch creation until a
 * Cluster Admin has verified the beekeeper's account - this is the actual
 * enforcement point behind the "verified beekeeper" badge shown everywhere
 * in the UI, not just decoration.
 */
function requireVerifiedBeekeeper(req, res, next) {
  const beekeeper = db.prepare('SELECT verified FROM beekeepers WHERE id = ?').get(req.user.beekeeper_id);
  if (!beekeeper || !beekeeper.verified) {
    return res.status(403).json({
      error: 'Your beekeeper account is pending admin verification. You can\'t record harvests until it\'s approved.',
    });
  }
  next();
}

module.exports = { requireAuth, requireRole, requireVerifiedBeekeeper, parseCookies, COOKIE_NAME };
