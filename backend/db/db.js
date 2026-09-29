const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// Uses Node's built-in SQLite (no native compilation required - avoids the
// better-sqlite3/node-gyp/Visual-Studio pain on Windows). Requires Node 22.5+.

const DB_PATH = process.env.HONEYCHAIN_DB_PATH || path.join(__dirname, 'honeychain.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
// If a second process/connection is mid-write when another tries to write,
// SQLite normally fails immediately with SQLITE_BUSY. This makes it instead
// wait up to 5s for the lock to free before giving up - turns a routine
// write-write race under load into a brief wait rather than a hard error.
db.exec('PRAGMA busy_timeout = 5000;');

const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
db.exec(schema);

// better-sqlite3 ships a `db.transaction(fn)` helper; node:sqlite doesn't, so
// we provide a tiny compatible shim (used in routes/hives.js and db/seed.js).
// `{ immediate: true }` uses BEGIN IMMEDIATE instead of plain BEGIN - it
// grabs SQLite's write lock up front rather than at the first write
// statement, which matters when the transaction does a read-then-write and
// needs the whole thing to be atomic against other writers (see
// services/ledger.js's appendEvent for why this matters).
db.transaction = function (fn, options = {}) {
  const beginStatement = options.immediate ? 'BEGIN IMMEDIATE' : 'BEGIN';
  return function (...args) {
    db.exec(beginStatement);
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
};

module.exports = db;
