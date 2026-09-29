const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireRole('admin'));

// GET /api/admin/beekeepers?status=pending|verified|all
router.get('/beekeepers', (req, res) => {
  const status = req.query.status || 'all';
  let rows;
  if (status === 'pending') {
    rows = db.prepare('SELECT * FROM beekeepers WHERE verified = 0').all();
  } else if (status === 'verified') {
    rows = db.prepare('SELECT * FROM beekeepers WHERE verified = 1').all();
  } else {
    rows = db.prepare('SELECT * FROM beekeepers').all();
  }
  res.json(rows);
});

// POST /api/admin/beekeepers/:id/verify - the actual enforcement point behind
// the "verified beekeeper" badge shown throughout the UI.
router.post('/beekeepers/:id/verify', (req, res) => {
  const beekeeper = db.prepare('SELECT * FROM beekeepers WHERE id = ?').get(req.params.id);
  if (!beekeeper) return res.status(404).json({ error: 'Beekeeper not found.' });

  db.prepare('UPDATE beekeepers SET verified = 1 WHERE id = ?').run(beekeeper.id);
  res.json({ ok: true, beekeeper_id: beekeeper.id, verified: true });
});

module.exports = router;
