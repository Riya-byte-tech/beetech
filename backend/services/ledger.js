const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/db');

const GENESIS_HASH = '0'.repeat(64);

/**
 * Canonicalize an event's fields into a deterministic string before hashing.
 * Order matters - keep it stable across the whole app.
 */
function canonicalize(event) {
  return JSON.stringify({
    batch_id: event.batch_id,
    event_type: event.event_type,
    actor: event.actor || null,
    payload: event.payload || {},
    timestamp: event.timestamp,
  });
}

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function getLastEvent() {
  return db.prepare('SELECT * FROM batch_events ORDER BY seq DESC LIMIT 1').get();
}

/**
 * Append a new event to the ledger. Returns the stored event row (with hash).
 * This is the ONLY way events should ever be written - never UPDATE/DELETE batch_events.
 *
 * Concurrency: the read of the last event and the insert of the new one are
 * wrapped in a single `BEGIN IMMEDIATE` transaction. Plain `BEGIN` only takes
 * SQLite's write lock at the first write statement, leaving a window between
 * our SELECT and our INSERT where a second connection could read the same
 * "last event" and compute the same seq/prev_hash. `BEGIN IMMEDIATE` takes
 * the write lock up front, so a second concurrent writer blocks (and retries,
 * per the busy_timeout set in db.js) until this transaction commits, rather
 * than racing it. The UNIQUE constraint on batch_events.seq (schema.sql) is a
 * second, independent safety net: even if this transaction logic were ever
 * bypassed or a bug reintroduced the gap, a duplicate seq fails loudly with a
 * constraint violation instead of silently corrupting the chain's ordering.
 *
 * This matters most in a multi-process deployment (Node cluster, PM2 cluster
 * mode, multiple containers) - within a single process, Node's synchronous
 * SQLite driver plus JS's run-to-completion model already serializes this,
 * but that's an implicit property of there being no `await` in this
 * function, not a real guarantee, and it doesn't hold across processes at all.
 */
function appendEvent({ batch_id, event_type, actor, payload }) {
  const run = db.transaction(() => {
    const last = getLastEvent();
    const seq = last ? last.seq + 1 : 1;
    const prev_hash = last ? last.hash : GENESIS_HASH;
    const timestamp = new Date().toISOString();

    const eventForHash = { batch_id, event_type, actor, payload, timestamp };
    const hash = sha256(prev_hash + canonicalize(eventForHash));

    const id = uuidv4();
    db.prepare(`
      INSERT INTO batch_events (id, seq, batch_id, event_type, actor, payload, timestamp, prev_hash, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, seq, batch_id, event_type, actor || null, JSON.stringify(payload || {}), timestamp, prev_hash, hash);

    return { id, seq, batch_id, event_type, actor, payload, timestamp, prev_hash, hash };
  }, { immediate: true });

  return run();
}

function getEventsForBatch(batch_id) {
  return db.prepare('SELECT * FROM batch_events WHERE batch_id = ? ORDER BY seq ASC').all(batch_id)
    .map(row => ({ ...row, payload: JSON.parse(row.payload) }));
}

/**
 * Recompute the entire chain from genesis and compare stored hashes to
 * recomputed hashes. This is what the consumer-facing "Verify Integrity"
 * button calls - it's a real integrity check, not decoration.
 */
function verifyChain() {
  const rows = db.prepare('SELECT * FROM batch_events ORDER BY seq ASC').all();
  let expectedPrev = GENESIS_HASH;
  const brokenAt = [];

  for (const row of rows) {
    const recomputed = sha256(expectedPrev + canonicalize({
      batch_id: row.batch_id,
      event_type: row.event_type,
      actor: row.actor,
      payload: JSON.parse(row.payload),
      timestamp: row.timestamp,
    }));

    if (row.prev_hash !== expectedPrev || row.hash !== recomputed) {
      brokenAt.push({ seq: row.seq, id: row.id, event_type: row.event_type });
    }
    expectedPrev = row.hash;
  }

  return {
    valid: brokenAt.length === 0,
    total_events: rows.length,
    broken_events: brokenAt,
  };
}

module.exports = { appendEvent, getEventsForBatch, verifyChain, sha256 };
