// Spawned as a separate OS process by ledger-concurrency.test.js. Each
// instance independently requires db.js and ledger.js - a fresh module
// load, fresh DatabaseSync connection, fresh event loop, in its own process.
// This is what makes it a genuine test of cross-process concurrency rather
// than same-process (non-)concurrency.
const [, , backendRoot, dbPath, batchId, workerId, countStr] = process.argv;

process.env.HONEYCHAIN_DB_PATH = dbPath;
const { appendEvent } = require(require('path').join(backendRoot, 'services', 'ledger'));

const count = parseInt(countStr, 10);

for (let i = 0; i < count; i++) {
  let attempts = 0;
  // A real route handler hitting SQLITE_BUSY would similarly retry rather
  // than fail the request outright; busy_timeout (db.js) already handles
  // short waits, this loop is a backstop for anything longer.
  while (true) {
    try {
      appendEvent({
        batch_id: batchId,
        event_type: `WORKER_${workerId}_EVENT_${i}`,
        actor: `worker-${workerId}`,
        payload: { i },
      });
      break;
    } catch (err) {
      attempts++;
      if (attempts > 50) {
        console.error(`worker ${workerId} gave up on event ${i}: ${err.message}`);
        process.exit(1);
      }
      const waitMs = Math.floor(Math.random() * 5);
      const start = Date.now();
      while (Date.now() - start < waitMs) { /* brief busy-wait backoff */ }
    }
  }
}

process.exit(0);
