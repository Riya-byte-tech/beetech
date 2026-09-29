const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

// IMPORTANT: this test intentionally uses real child PROCESSES, not
// Promise.all() in this same process. Node's synchronous SQLite driver plus
// JS's run-to-completion model already prevents same-process interleaving
// between appendEvent()'s read and write - a same-process test would pass
// even with the race condition bug still present. Only genuine OS-level
// concurrency (separate processes, separate event loops) exercises the
// thing services/ledger.js's BEGIN IMMEDIATE transaction actually protects
// against: multiple processes (Node cluster, PM2, multiple containers)
// racing to append to the same shared SQLite file.

const TEST_DB = path.join(__dirname, 'tmp-concurrency.db');
const BACKEND_ROOT = path.join(__dirname, '..');

function cleanupDbFiles() {
  for (const ext of ['', '-shm', '-wal']) {
    const p = TEST_DB + ext;
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (err) {
      console.warn(`Warning: could not remove ${p}: ${err.message}`);
    }
  }
}

cleanupDbFiles();
process.env.HONEYCHAIN_DB_PATH = TEST_DB;
const db = require('../db/db');
const { verifyChain } = require('../services/ledger');

test.before(() => {
  db.exec(`INSERT INTO beekeepers (id, name, verified) VALUES ('BK-CONC','Concurrency Test',1)`);
  db.exec(`INSERT INTO apiaries (id, beekeeper_id) VALUES ('AP-CONC','BK-CONC')`);
  db.exec(`INSERT INTO harvests (id, hive_ids, beekeeper_id, date, quantity_kg) VALUES ('HV-CONC','[]','BK-CONC','2026-01-01',1)`);
  db.exec(`INSERT INTO batches (id, batch_code, harvest_id, created_at) VALUES ('BT-CONC','CODE-CONC','HV-CONC','2026-01-01')`);
});

test.after(() => {
  try { db.close(); } catch { /* already closed or never opened */ }
  cleanupDbFiles();
});

function runWorker(workerId, appendsPerWorker) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(__dirname, 'helpers', 'concurrentAppendWorker.js'),
      BACKEND_ROOT, TEST_DB, 'BT-CONC', String(workerId), String(appendsPerWorker),
    ]);
    let stderr = '';
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('close', code => {
      if (code !== 0) reject(new Error(`worker ${workerId} exited ${code}: ${stderr}`));
      else resolve();
    });
  });
}

test('N concurrent OS processes appending to the same batch produce a gap-free, duplicate-free, valid chain', async () => {
  const WORKERS = 5;
  const APPENDS_PER_WORKER = 15;

  // Launch all workers essentially simultaneously - this is the part a
  // same-process test cannot reproduce.
  await Promise.all(
    Array.from({ length: WORKERS }, (_, i) => runWorker(i + 1, APPENDS_PER_WORKER))
  );

  const rows = db.prepare('SELECT seq FROM batch_events ORDER BY seq ASC').all();
  const seqs = rows.map(r => r.seq);
  const expectedTotal = WORKERS * APPENDS_PER_WORKER;

  assert.strictEqual(seqs.length, expectedTotal, 'every append from every worker should have landed');
  assert.strictEqual(new Set(seqs).size, expectedTotal, 'no two events should share a seq value');
  assert.deepStrictEqual(
    seqs,
    Array.from({ length: expectedTotal }, (_, i) => i + 1),
    'seq should be a clean, gap-free 1..N sequence'
  );

  const result = verifyChain();
  assert.strictEqual(result.valid, true, 'the hash chain built under concurrent writers must still verify');
  assert.strictEqual(result.broken_events.length, 0);
});
