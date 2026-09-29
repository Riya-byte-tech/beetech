const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const db = require('../db/db');
const { verifyChain } = require('./ledger');

const AMBER = '#b8760a';
const INK = '#2b2116';
const INK_SOFT = '#6b5c47';

function section(doc, title) {
  doc.fontSize(12).fillColor(AMBER).text(title, { underline: false });
  doc.moveDown(0.3);
}

function row(doc, label, value) {
  doc.fontSize(10).fillColor(INK_SOFT).text(label, { continued: true, width: 150 });
  doc.fillColor(INK).text(`   ${value}`);
}

/**
 * Streams a PDF certificate of provenance for the given batch row directly
 * into the HTTP response. Caller is responsible for looking up `batch`
 * (by internal id or by batch_code) and setting response headers.
 */
async function streamCertificate(res, batch) {
  const harvest = db.prepare('SELECT * FROM harvests WHERE id = ?').get(batch.harvest_id);
  const beekeeper = harvest ? db.prepare('SELECT * FROM beekeepers WHERE id = ?').get(harvest.beekeeper_id) : null;
  const qualityTest = db.prepare('SELECT * FROM quality_tests WHERE batch_id = ? ORDER BY tested_at DESC LIMIT 1').get(batch.id);
  const events = db.prepare('SELECT * FROM batch_events WHERE batch_id = ? ORDER BY seq ASC').all(batch.id);
  const product = db.prepare('SELECT * FROM products WHERE batch_id = ?').get(batch.id);
  const integrity = verifyChain();

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${batch.batch_code}-certificate.pdf"`);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);

  doc.fontSize(22).fillColor(AMBER).text('Honey Chain', { continued: false });
  doc.fontSize(14).fillColor(INK).text('Certificate of Provenance', { paragraphGap: 4 });
  doc.moveDown(0.5);
  doc.strokeColor(AMBER).lineWidth(1.5).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(1);

  doc.fontSize(18).fillColor(INK).text(batch.batch_code, { underline: false });
  doc.fontSize(10).fillColor(INK_SOFT).text(`Status: ${batch.status}   ·   Created: ${new Date(batch.created_at).toLocaleString()}`);
  doc.moveDown(1);

  section(doc, 'Origin');
  row(doc, 'Producer', beekeeper ? (beekeeper.verified ? 'Verified beekeeper' : 'Unverified') : 'Unknown');
  row(doc, 'District / State', beekeeper ? `${beekeeper.district || '—'}, ${beekeeper.state || '—'}` : '—');
  if (harvest) {
    row(doc, 'Harvest date', new Date(harvest.date).toLocaleDateString());
    row(doc, 'Floral source', harvest.floral_source || '—');
    row(doc, 'Quantity', `${harvest.quantity_kg} kg`);
    row(doc, 'Source hives', JSON.parse(harvest.hive_ids).join(', '));
  }
  doc.moveDown(0.5);

  if (qualityTest) {
    section(doc, `Quality Test ${qualityTest.is_simulated ? '(simulated demo record)' : ''}`);
    row(doc, 'Result', qualityTest.result);
    row(doc, 'Moisture', `${qualityTest.moisture}%`);
    row(doc, 'HMF', `${qualityTest.hmf} mg/kg`);
    row(doc, 'C4 Sugar', `${qualityTest.c4_sugar}%`);
    row(doc, 'Tested at', new Date(qualityTest.tested_at).toLocaleString());
    doc.moveDown(0.5);
  }

  section(doc, 'Traceability Ledger');
  events.forEach((ev, i) => {
    doc.fontSize(10).fillColor(INK).text(`${i + 1}. ${ev.event_type.replaceAll('_', ' ')}`, { continued: true });
    doc.fillColor(INK_SOFT).text(`   ${new Date(ev.timestamp).toLocaleString()}`);
    doc.fontSize(7).fillColor('#a08a5f').text(`   hash: ${ev.hash}`);
  });
  doc.moveDown(0.5);

  section(doc, 'Blockchain Integrity Check');
  doc.fontSize(10).fillColor(integrity.valid ? '#2e7d32' : '#c62828')
    .text(integrity.valid
      ? `VERIFIED - All ${integrity.total_events} ledger events checked at time of generation. No tampering detected.`
      : `WARNING - Integrity check FAILED. ${integrity.broken_events.length} event(s) did not match their recorded hash.`);
  doc.moveDown(1);

  if (product) {
    const qrBuffer = await QRCode.toBuffer(`https://honeychain.demo/verify/${product.qr_token}`, { margin: 1, width: 160 });
    doc.fontSize(10).fillColor(INK_SOFT).text('Scan to verify online:');
    doc.image(qrBuffer, { width: 120 });
  }

  doc.fontSize(8).fillColor(INK_SOFT).text(
    'This certificate is generated from Honey Chain\'s internal ledger for demonstration purposes. ' +
    'Quality-test values are simulated and do not represent an accredited laboratory result.',
    50, 760, { width: 495 }
  );

  doc.end();
}

module.exports = { streamCertificate };
