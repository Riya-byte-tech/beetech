require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

require('./db/db'); // ensures schema is applied on boot

const authRoute = require('./routes/auth');
const adminRoute = require('./routes/admin');
const hivesRoute = require('./routes/hives');
const harvestsRoute = require('./routes/harvests');
const batchesRoute = require('./routes/batches');
const qualityRoute = require('./routes/quality');
const { router: productsRoute, publicRouter: verifyRoute } = require('./routes/products');
const alertsRoute = require('./routes/alerts');
const ledgerRoute = require('./routes/ledger');
const { router: certificateRoute, publicRouter: certificatePublicRoute } = require('./routes/certificate');

const app = express();

app.use(helmet({
  // Relaxed CSP: this API serves PDFs/images cross-origin to the frontend
  // dev server; a strict default-src would break that without real payoff
  // for an API-only backend (no HTML is rendered here).
  contentSecurityPolicy: false,
}));

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  credentials: true, // required for the httpOnly session cookie to be sent/received
}));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'honey-chain-backend' }));

// Every route file below guards itself with requireAuth/requireRole - there's
// no blanket auth middleware here, so it's obvious from each route file
// exactly what access it needs, and the public consumer routes (verifyRoute,
// certificatePublicRoute) simply never import requireAuth at all.
app.use('/api/auth', authRoute);
app.use('/api/admin', adminRoute);
app.use('/api/hives', hivesRoute);
app.use('/api/harvests', harvestsRoute);
app.use('/api/batches', batchesRoute);
app.use('/api/batches', qualityRoute);     // adds POST /:batchId/quality-test under /api/batches
app.use('/api/batches', productsRoute);    // adds POST /:batchId/activate-qr under /api/batches
app.use('/api/batches', certificateRoute); // adds GET /:id/certificate under /api/batches
app.use('/api', verifyRoute);              // PUBLIC: GET /api/verify/:qrToken
app.use('/api', certificatePublicRoute);   // PUBLIC: GET /api/verify/:qrToken/certificate
app.use('/api/alerts', alertsRoute);
app.use('/api/ledger', ledgerRoute);

const PORT = process.env.PORT || 4000;

// Only actually bind to a port when run directly (`node server.js`) - this
// lets test files `require('./server')` get the configured `app` and mount
// it on an ephemeral port themselves, without double-binding :4000.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Honey Chain backend running on http://localhost:${PORT}`);
  });
}

module.exports = app;
