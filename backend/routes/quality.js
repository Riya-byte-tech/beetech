const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/db');
const { appendEvent } = require('../services/ledger');
const { assertQualityTest, StateTransitionError } = require('../services/batchStateMachine');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// FSSAI-style thresholds used only to classify our SIMULATED demo numbers.
// These are illustrative limits from the FSSAI honey standard, not a real lab integration.
const THRESHOLDS = {
  moisture_max: 20,     // %
  hmf_max: 80,           // mg/kg
  c4_sugar_max: 7,       // %
};

// POST /api/batches/:batchId/quality-test
// body: { moisture, hmf, c4_sugar }
// Restricted to the 'lab' role. If any value omitted, generates a plausible
// simulated value. `actor` is always the authenticated user's email.
router.post('/:batchId/quality-test', requireRole('lab'), (req, res) => {
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });

  try {
    assertQualityTest(batch);
  } catch (err) {
    if (err instanceof StateTransitionError) return res.status(err.statusCode).json({ error: err.message });
    throw err;
  }

  const rand = (min, max) => Math.round((min + Math.random() * (max - min)) * 10) / 10;

  const moisture = req.body.moisture ?? rand(16, 21);
  const hmf = req.body.hmf ?? rand(10, 90);
  const c4_sugar = req.body.c4_sugar ?? rand(1, 8);
  const actor = req.user.email;

  const failReasons = [];
  if (moisture > THRESHOLDS.moisture_max) failReasons.push(`Moisture ${moisture}% exceeds ${THRESHOLDS.moisture_max}%`);
  if (hmf > THRESHOLDS.hmf_max) failReasons.push(`HMF ${hmf}mg/kg exceeds ${THRESHOLDS.hmf_max}mg/kg`);
  if (c4_sugar > THRESHOLDS.c4_sugar_max) failReasons.push(`C4 sugar ${c4_sugar}% exceeds ${THRESHOLDS.c4_sugar_max}%`);

  const result = failReasons.length > 0 ? 'FAIL' : 'PASS';
  const testedAt = new Date().toISOString();
  const id = uuidv4();

  db.prepare(`
    INSERT INTO quality_tests (id, batch_id, moisture, hmf, c4_sugar, result, is_simulated, tested_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `).run(id, batch.id, moisture, hmf, c4_sugar, result, testedAt);

  const newStatus = result === 'PASS' ? 'TESTED' : 'QUARANTINED';
  db.prepare('UPDATE batches SET status = ? WHERE id = ?').run(newStatus, batch.id);

  const event = appendEvent({
    batch_id: batch.id,
    event_type: result === 'PASS' ? 'BATCH_TESTED' : 'BATCH_FAILED',
    actor,
    payload: { moisture, hmf, c4_sugar, result, fail_reasons: failReasons, is_simulated: true },
  });

  res.status(201).json({
    quality_test: { id, batch_id: batch.id, moisture, hmf, c4_sugar, result, is_simulated: true, tested_at: testedAt },
    new_status: newStatus,
    event,
  });
});

module.exports = router;
