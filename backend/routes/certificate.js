const express = require('express');
const db = require('../db/db');
const { streamCertificate } = require('../services/certificatePdf');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();       // mounted at /api/batches -> GET /:id/certificate (auth required)
const publicRouter = express.Router(); // mounted at /api        -> GET /verify/:qrToken/certificate (public)

router.get('/:id/certificate', requireAuth, async (req, res) => {
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });

  if (req.user.role === 'beekeeper') {
    const harvest = db.prepare('SELECT beekeeper_id FROM harvests WHERE id = ?').get(batch.harvest_id);
    if (!harvest || harvest.beekeeper_id !== req.user.beekeeper_id) {
      return res.status(403).json({ error: 'You do not have access to this batch.' });
    }
  }

  await streamCertificate(res, batch);
});

// Public version - consumers reach this via the batch's human-readable code (QR token)
publicRouter.get('/verify/:qrToken/certificate', async (req, res) => {
  const batch = db.prepare('SELECT * FROM batches WHERE batch_code = ?').get(req.params.qrToken);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  await streamCertificate(res, batch);
});

module.exports = { router, publicRouter };
