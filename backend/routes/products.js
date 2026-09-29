const express = require('express');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const db = require('../db/db');
const { appendEvent, verifyChain } = require('../services/ledger');
const { assertActivateQr, StateTransitionError } = require('../services/batchStateMachine');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();       // mounted at /api/batches -> POST /:batchId/activate-qr (auth required)
const publicRouter = express.Router(); // mounted at /api        -> GET /verify/:qrToken (no auth - consumers)

// POST /api/batches/:batchId/activate-qr
// Packages the product and activates its QR identity. Writes QR_ACTIVATED
// event. Restricted to 'lab' - packaging is a processing-floor action.
router.post('/:batchId/activate-qr', requireAuth, requireRole('lab'), async (req, res) => {
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });

  const existing = db.prepare('SELECT * FROM products WHERE batch_id = ?').get(batch.id);
  if (existing) {
    return res.status(200).json({ product: existing, already_activated: true });
  }

  try {
    assertActivateQr(batch);
  } catch (err) {
    if (err instanceof StateTransitionError) return res.status(err.statusCode).json({ error: err.message });
    throw err;
  }

  const id = uuidv4();
  const qrToken = batch.batch_code; // human-readable token used as the QR payload
  const activatedAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO products (id, batch_id, qr_token, activated_at)
    VALUES (?, ?, ?, ?)
  `).run(id, batch.id, qrToken, activatedAt);

  db.prepare('UPDATE batches SET status = ? WHERE id = ?').run('PACKAGED', batch.id);

  const event = appendEvent({
    batch_id: batch.id,
    event_type: 'QR_ACTIVATED',
    actor: req.user.email,
    payload: { qr_token: qrToken },
  });

  // Encode a URL the consumer app can open on scan.
  const verifyUrl = `${req.body.consumer_base_url || 'https://honeychain.demo'}/verify/${qrToken}`;
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 320 });

  res.status(201).json({
    product: { id, batch_id: batch.id, qr_token: qrToken, activated_at: activatedAt },
    qr_data_url: qrDataUrl,
    verify_url: verifyUrl,
    event,
  });
});

// GET /api/verify/:qrToken - PUBLIC consumer verification endpoint.
// Deliberately returns only what a consumer should see (no beekeeper phone/address etc).
publicRouter.get('/verify/:qrToken', (req, res) => {
  const batch = db.prepare('SELECT * FROM batches WHERE batch_code = ?').get(req.params.qrToken);
  if (!batch) return res.status(404).json({ error: 'Product not found or not yet verified.' });

  const harvest = db.prepare('SELECT * FROM harvests WHERE id = ?').get(batch.harvest_id);
  const beekeeper = harvest ? db.prepare('SELECT * FROM beekeepers WHERE id = ?').get(harvest.beekeeper_id) : null;
  const qualityTest = db.prepare('SELECT * FROM quality_tests WHERE batch_id = ? ORDER BY tested_at DESC LIMIT 1').get(batch.id);
  const events = db.prepare('SELECT * FROM batch_events WHERE batch_id = ? ORDER BY seq ASC').all(batch.id)
    .map(e => ({ event_type: e.event_type, timestamp: e.timestamp, hash: e.hash }));

  const integrity = verifyChain();

  res.json({
    batch_code: batch.batch_code,
    status: batch.status,
    origin: {
      district: beekeeper?.district || 'Unknown',
      state: beekeeper?.state || 'Unknown',
      producer_verified: !!beekeeper?.verified,
    },
    harvest: harvest ? {
      date: harvest.date,
      floral_source: harvest.floral_source,
      quantity_kg: harvest.quantity_kg,
      hive_count: JSON.parse(harvest.hive_ids).length,
    } : null,
    quality: qualityTest ? {
      result: qualityTest.result,
      is_simulated: !!qualityTest.is_simulated,
      tested_at: qualityTest.tested_at,
    } : null,
    traceability_journey: events,
    blockchain_integrity: integrity,
  });
});

module.exports = { router, publicRouter };
