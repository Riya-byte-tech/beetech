const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/db');
const { generateReadings } = require('../services/simulator');
const { enrichHive, enrichHiveSummary } = require('../services/hiveEnrichment');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function assertOwnsHive(req, hive) {
  return req.user.role === 'admin' || hive.beekeeper_id === req.user.beekeeper_id;
}

// GET /api/hives - beekeepers see only their own hives; admins see everyone's;
// lab has no reason to list hives directly (they work at the batch level).
router.get('/', (req, res) => {
  if (req.user.role === 'lab') {
    return res.status(403).json({ error: 'Lab accounts work with batches, not hives directly.' });
  }

  const hives = req.user.role === 'beekeeper'
    ? db.prepare('SELECT * FROM hives WHERE beekeeper_id = ?').all(req.user.beekeeper_id)
    : db.prepare('SELECT * FROM hives').all(); // admin: cluster-wide view

  res.json(hives.map(enrichHiveSummary));
});

// POST /api/hives - register a new hive for the LOGGED-IN beekeeper.
// beekeeper_id/apiary_id are resolved server-side from the session, never
// trusted from the request body (previously a client could register a hive
// under any beekeeper_id it liked).
router.post('/', requireRole('beekeeper'), (req, res) => {
  const { species, simulate_profile } = req.body;

  const apiary = db.prepare('SELECT id FROM apiaries WHERE beekeeper_id = ?').get(req.user.beekeeper_id);
  if (!apiary) {
    return res.status(500).json({ error: 'No apiary found for this account - this should not happen for a registered beekeeper.' });
  }

  const id = 'H-' + uuidv4().slice(0, 6).toUpperCase();
  const installed_at = new Date().toISOString();

  db.prepare(`
    INSERT INTO hives (id, apiary_id, beekeeper_id, species, status, installed_at)
    VALUES (?, ?, ?, ?, 'ACTIVE', ?)
  `).run(id, apiary.id, req.user.beekeeper_id, species || 'Apis cerana', installed_at);

  // Seed simulated sensor history so the hive isn't empty on first view
  const readings = generateReadings(id, 24, simulate_profile || 'healthy');
  const insert = db.prepare(`
    INSERT INTO sensor_readings (id, hive_id, timestamp, temperature, humidity, weight)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((rows) => {
    for (const r of rows) insert.run(r.id, r.hive_id, r.timestamp, r.temperature, r.humidity, r.weight);
  });
  insertMany(readings);

  res.status(201).json({ id, apiary_id: apiary.id, beekeeper_id: req.user.beekeeper_id, species, status: 'ACTIVE', installed_at });
});

// GET /api/hives/:id - full hive detail with readings + AI insight
router.get('/:id', (req, res) => {
  const hive = db.prepare('SELECT * FROM hives WHERE id = ?').get(req.params.id);
  if (!hive) return res.status(404).json({ error: 'Hive not found' });

  if (req.user.role === 'lab' || !assertOwnsHive(req, hive)) {
    return res.status(403).json({ error: 'You do not have access to this hive.' });
  }

  res.json(enrichHive(hive));
});

// POST /api/hives/:id/simulate - regenerate a fresh reading batch (demo convenience)
router.post('/:id/simulate', requireRole('beekeeper'), (req, res) => {
  const hive = db.prepare('SELECT * FROM hives WHERE id = ?').get(req.params.id);
  if (!hive) return res.status(404).json({ error: 'Hive not found' });
  if (!assertOwnsHive(req, hive)) {
    return res.status(403).json({ error: 'You do not have access to this hive.' });
  }

  const profile = req.body.profile || 'healthy';
  db.prepare('DELETE FROM sensor_readings WHERE hive_id = ?').run(hive.id);

  const readings = generateReadings(hive.id, 24, profile);
  const insert = db.prepare(`
    INSERT INTO sensor_readings (id, hive_id, timestamp, temperature, humidity, weight)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((rows) => {
    for (const r of rows) insert.run(r.id, r.hive_id, r.timestamp, r.temperature, r.humidity, r.weight);
  });
  insertMany(readings);

  res.json({ ok: true, profile, count: readings.length });
});

module.exports = router;
