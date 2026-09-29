const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/db');
const { appendEvent } = require('../services/ledger');
const { requireAuth, requireRole, requireVerifiedBeekeeper } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// POST /api/harvests
// body: { hive_ids: [...], quantity_kg, floral_source, location }
// beekeeper_id is ALWAYS taken from the logged-in session, never from the
// request body - previously a client could pass any beekeeper_id it liked.
// Gated by requireVerifiedBeekeeper: this is the actual enforcement point
// behind the "pending verification" story - an unverified beekeeper can
// register hives and watch sensor data, but cannot enter anything into the
// traceability chain until a Cluster Admin approves their account.
router.post('/', requireRole('beekeeper'), requireVerifiedBeekeeper, (req, res) => {
  const { hive_ids, quantity_kg, floral_source, location } = req.body;
  const beekeeper_id = req.user.beekeeper_id;

  if (!Array.isArray(hive_ids) || hive_ids.length === 0 || !quantity_kg) {
    return res.status(400).json({ error: 'hive_ids (array) and quantity_kg are required' });
  }

  // hive_ids is stored as a JSON blob (a harvest can span multiple hives), so
  // it isn't a real foreign-key column and SQLite's FK enforcement can't
  // catch a bogus hive id here - we have to check it ourselves.
  const placeholders = hive_ids.map(() => '?').join(',');
  const foundHives = db.prepare(
    `SELECT id, beekeeper_id FROM hives WHERE id IN (${placeholders})`
  ).all(...hive_ids);

  const foundIds = new Set(foundHives.map(h => h.id));
  const missing = hive_ids.filter(id => !foundIds.has(id));
  if (missing.length > 0) {
    return res.status(400).json({ error: `Unknown hive_ids: ${missing.join(', ')}` });
  }

  const wrongOwner = foundHives.filter(h => h.beekeeper_id !== beekeeper_id).map(h => h.id);
  if (wrongOwner.length > 0) {
    return res.status(403).json({ error: `You do not own these hives: ${wrongOwner.join(', ')}` });
  }

  const harvestId = 'HV-' + uuidv4().slice(0, 8).toUpperCase();
  const date = new Date().toISOString();

  db.prepare(`
    INSERT INTO harvests (id, hive_ids, beekeeper_id, date, quantity_kg, floral_source, location)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(harvestId, JSON.stringify(hive_ids), beekeeper_id, date, quantity_kg, floral_source || null, location || null);

  // Generate a human-readable batch code: HC-<STATE>-<YEAR>-<seq>
  const year = new Date().getFullYear();
  const countRow = db.prepare('SELECT COUNT(*) as c FROM batches').get();
  const seq = String(countRow.c + 1).padStart(4, '0');
  const batchCode = `HC-MH-${year}-${seq}`;

  const batchId = 'BT-' + uuidv4().slice(0, 8).toUpperCase();
  db.prepare(`
    INSERT INTO batches (id, batch_code, harvest_id, status, created_at)
    VALUES (?, ?, ?, 'CREATED', ?)
  `).run(batchId, batchCode, harvestId, date);

  // Ledger events - this is what makes it "traceable", not just a database row.
  const harvestEvent = appendEvent({
    batch_id: batchId,
    event_type: 'HARVEST_RECORDED',
    actor: beekeeper_id,
    payload: { harvest_id: harvestId, hive_ids, quantity_kg, floral_source, location, date },
  });

  const batchEvent = appendEvent({
    batch_id: batchId,
    event_type: 'BATCH_CREATED',
    actor: beekeeper_id,
    payload: { batch_code: batchCode, harvest_id: harvestId },
  });

  res.status(201).json({
    harvest: { id: harvestId, hive_ids, beekeeper_id, date, quantity_kg, floral_source, location },
    batch: { id: batchId, batch_code: batchCode, harvest_id: harvestId, status: 'CREATED', created_at: date },
    ledger_events: [harvestEvent, batchEvent],
  });
});

// GET /api/harvests - beekeepers see only their own; lab/admin see all
// (lab needs this for context on what's coming through the pipeline).
router.get('/', (req, res) => {
  const rows = req.user.role === 'beekeeper'
    ? db.prepare('SELECT * FROM harvests WHERE beekeeper_id = ? ORDER BY date DESC').all(req.user.beekeeper_id)
    : db.prepare('SELECT * FROM harvests ORDER BY date DESC').all();

  res.json(rows.map(r => ({ ...r, hive_ids: JSON.parse(r.hive_ids) })));
});

module.exports = router;
