const express = require('express');
const db = require('../db/db');
const { enrichHive } = require('../services/hiveEnrichment');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

// GET /api/alerts - cluster-wide view across ALL beekeepers/hives.
// Returns summary counts plus the list of hives currently flagged
// Attention/Critical, sorted worst-first. This is the "KVIC/cluster
// administrator" view from our stakeholder research - it doesn't matter
// which beekeeper owns a hive, only which hives need attention right now.
router.get('/', (req, res) => {
  const hives = db.prepare(`
    SELECT h.*, b.name as beekeeper_name, b.district, b.state, a.name as apiary_name
    FROM hives h
    LEFT JOIN beekeepers b ON h.beekeeper_id = b.id
    LEFT JOIN apiaries a ON h.apiary_id = a.id
  `).all();

  const enriched = hives.map(hive => {
    const { readings, yield_prediction, ...rest } = enrichHive(hive);
    return rest; // includes health {score, status, reason, flag}
  });

  const counts = enriched.reduce((acc, h) => {
    acc[h.health.status] = (acc[h.health.status] || 0) + 1;
    return acc;
  }, { Healthy: 0, Attention: 0, Critical: 0, Unknown: 0 });

  const flagged = enriched
    .filter(h => h.health.status === 'Attention' || h.health.status === 'Critical')
    .sort((a, b) => (a.health.score ?? 0) - (b.health.score ?? 0));

  res.json({
    total_hives: enriched.length,
    counts,
    flagged,
  });
});

module.exports = router;
