const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/db');
const { hashPassword, verifyPassword, signToken } = require('../services/auth');
const { requireAuth, COOKIE_NAME } = require('../middleware/auth');

const router = express.Router();

const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, matches token expiry in services/auth.js

function cookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax', // cross-site cookies need SameSite=None, which requires...
    secure: isProd,                     // ...Secure, which requires HTTPS - fine in prod, not needed on localhost
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  };
}

function publicUser(user, beekeeper) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    beekeeper: beekeeper
      ? { id: beekeeper.id, name: beekeeper.name, district: beekeeper.district, state: beekeeper.state, verified: !!beekeeper.verified }
      : null,
  };
}

// POST /api/auth/register - beekeeper self-registration ONLY. Lab/admin
// accounts are provisioned via db/seed.js (see Decision 2: no in-app staff
// management UI for this MVP).
router.post('/register', (req, res) => {
  const { name, email, password, district, state, phone } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  if (phone) {
    const phoneTaken = db.prepare('SELECT id FROM beekeepers WHERE phone = ?').get(phone);
    if (phoneTaken) {
      return res.status(409).json({ error: 'An account with that phone number already exists.' });
    }
  }

  const beekeeperId = 'BK-' + uuidv4().slice(0, 6).toUpperCase();
  const apiaryId = 'AP-' + uuidv4().slice(0, 6).toUpperCase();
  const userId = 'U-' + uuidv4().slice(0, 8).toUpperCase();
  const passwordHash = hashPassword(password);
  const now = new Date().toISOString();

  const createAll = db.transaction(() => {
    // verified=0 by default (schema default) - pending Cluster Admin approval
    db.prepare('INSERT INTO beekeepers (id, name, district, state, phone) VALUES (?, ?, ?, ?, ?)')
      .run(beekeeperId, name, district || null, state || null, phone || null);
    db.prepare('INSERT INTO apiaries (id, beekeeper_id, name, location) VALUES (?, ?, ?, ?)')
      .run(apiaryId, beekeeperId, 'Main Apiary', district && state ? `${district}, ${state}` : null);
    db.prepare('INSERT INTO users (id, email, password_hash, role, beekeeper_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, email.toLowerCase(), passwordHash, 'beekeeper', beekeeperId, now);
  });
  createAll();

  const token = signToken({ userId, role: 'beekeeper' });
  res.cookie(COOKIE_NAME, token, cookieOptions());

  const beekeeper = db.prepare('SELECT * FROM beekeepers WHERE id = ?').get(beekeeperId);
  res.status(201).json({
    user: publicUser({ id: userId, email: email.toLowerCase(), role: 'beekeeper' }, beekeeper),
    message: 'Registered. Your account is pending Cluster Admin verification before you can record harvests.',
  });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = signToken({ userId: user.id, role: user.role });
  res.cookie(COOKIE_NAME, token, cookieOptions());

  const beekeeper = user.beekeeper_id
    ? db.prepare('SELECT * FROM beekeepers WHERE id = ?').get(user.beekeeper_id)
    : null;
  res.json({ user: publicUser(user, beekeeper) });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

// GET /api/auth/me - used by the frontend on load to restore a session
router.get('/me', requireAuth, (req, res) => {
  const beekeeper = req.user.beekeeper_id
    ? db.prepare('SELECT * FROM beekeepers WHERE id = ?').get(req.user.beekeeper_id)
    : null;
  res.json({ user: publicUser(req.user, beekeeper) });
});

module.exports = router;
