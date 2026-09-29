const express = require('express');
const db = require('../db/db');
const { verifyChain } = require('../services/ledger');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

// GET /api/ledger - the WHOLE chain across every batch, most recent first,
// enriched with the human-readable batch code. This is what makes it feel
// like a real shared ledger rather than a per-batch log: one continuous,
// globally-ordered sequence of events (the `seq` column IS that global order).
router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 200, 500);

  const events = db.prepare(`
    SELECT e.*, b.batch_code
    FROM batch_events e
    LEFT JOIN batches b ON e.batch_id = b.id
    ORDER BY e.seq DESC
    LIMIT ?
  `).all(limit).map(row => ({ ...row, payload: JSON.parse(row.payload) }));

  const integrity = verifyChain();

  res.json({
    total_events: integrity.total_events,
    integrity,
    events,
  });
});

module.exports = router;
