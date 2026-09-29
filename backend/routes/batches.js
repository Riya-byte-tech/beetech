const express = require('express');
const db = require('../db/db');
const { appendEvent, getEventsForBatch, verifyChain } = require('../services/ledger');
const { assertAdvance, StateTransitionError } = require('../services/batchStateMachine');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const ALLOWED_MANUAL_EVENTS = ['BATCH_RECEIVED', 'BATCH_PROCESSED'];

function hydrateBatch(batch) {
  const harvest = db.prepare('SELECT * FROM harvests WHERE id = ?').get(batch.harvest_id);
  const events = getEventsForBatch(batch.id);
  const qualityTests = db.prepare('SELECT * FROM quality_tests WHERE batch_id = ? ORDER BY tested_at ASC').all(batch.id);
  const product = db.prepare('SELECT * FROM products WHERE batch_id = ?').get(batch.id);

  return {
    ...batch,
    harvest: harvest ? { ...harvest, hive_ids: JSON.parse(harvest.hive_ids) } : null,
    events,
    quality_tests: qualityTests,
    product: product || null,
  };
}

/** Beekeepers may only see batches whose harvest belongs to them. */
function assertCanViewBatch(req, batch) {
  if (req.user.role !== 'beekeeper') return true;
  const harvest = db.prepare('SELECT beekeeper_id FROM harvests WHERE id = ?').get(batch.harvest_id);
  return harvest && harvest.beekeeper_id === req.user.beekeeper_id;
}

// GET /api/batches - beekeepers see only their own batches; lab/admin see all
// (lab needs cross-beekeeper visibility to actually do their job).
router.get('/', (req, res) => {
  if (req.user.role === 'beekeeper') {
    const rows = db.prepare(`
      SELECT b.* FROM batches b
      JOIN harvests h ON b.harvest_id = h.id
      WHERE h.beekeeper_id = ?
      ORDER BY b.created_at DESC
    `).all(req.user.beekeeper_id);
    return res.json(rows);
  }
  res.json(db.prepare('SELECT * FROM batches ORDER BY created_at DESC').all());
});

// GET /api/batches/:id - full detail including ledger events
router.get('/:id', (req, res) => {
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  if (!assertCanViewBatch(req, batch)) return res.status(403).json({ error: 'You do not have access to this batch.' });
  res.json(hydrateBatch(batch));
});

// GET /api/batches/code/:code - lookup by human-readable batch code
router.get('/code/:code', (req, res) => {
  const batch = db.prepare('SELECT * FROM batches WHERE batch_code = ?').get(req.params.code);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  if (!assertCanViewBatch(req, batch)) return res.status(403).json({ error: 'You do not have access to this batch.' });
  res.json(hydrateBatch(batch));
});

// POST /api/batches/:id/advance
// body: { event_type: 'BATCH_RECEIVED' | 'BATCH_PROCESSED', note }
// Restricted to the 'lab' role - this is processing-floor work, not something
// a beekeeper or admin does directly. `actor` is always the authenticated
// user's email now, never a client-supplied string, so the ledger's actor
// field is tied to a real account.
router.post('/:id/advance', requireRole('lab'), (req, res) => {
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });

  const { event_type, note } = req.body;
  if (!ALLOWED_MANUAL_EVENTS.includes(event_type)) {
    return res.status(400).json({ error: `event_type must be one of: ${ALLOWED_MANUAL_EVENTS.join(', ')}` });
  }

  let newStatus;
  try {
    newStatus = assertAdvance(batch, event_type);
  } catch (err) {
    if (err instanceof StateTransitionError) return res.status(err.statusCode).json({ error: err.message });
    throw err;
  }

  const event = appendEvent({
    batch_id: batch.id,
    event_type,
    actor: req.user.email,
    payload: { note: note || null },
  });

  db.prepare('UPDATE batches SET status = ? WHERE id = ?').run(newStatus, batch.id);

  res.json({ ok: true, batch_id: batch.id, new_status: newStatus, event });
});

// GET /api/batches/:id/verify - recompute the ENTIRE chain and report integrity
// (Global chain verification; the consumer UI calls the public equivalent.)
router.get('/:id/verify', (req, res) => {
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  if (!assertCanViewBatch(req, batch)) return res.status(403).json({ error: 'You do not have access to this batch.' });

  const result = verifyChain();
  res.json(result);
});

module.exports = router;
