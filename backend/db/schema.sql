-- Honey Chain MVP schema
-- Deliberately small: one row per real-world entity, event ledger carries the "blockchain" story.

CREATE TABLE IF NOT EXISTS beekeepers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  district TEXT,
  state TEXT,
  phone TEXT UNIQUE, -- SQLite allows multiple NULLs under UNIQUE, so an omitted phone is fine
  verified INTEGER DEFAULT 0 -- 0 until a Cluster Admin approves; see users.role='admin'
);

-- Login accounts. Separate from `beekeepers` because a lab/admin user has no
-- beekeeper profile at all - beekeeper_id is only ever set for role='beekeeper'.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('beekeeper', 'lab', 'admin')),
  beekeeper_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (beekeeper_id) REFERENCES beekeepers(id)
);

CREATE TABLE IF NOT EXISTS apiaries (
  id TEXT PRIMARY KEY,
  beekeeper_id TEXT NOT NULL,
  name TEXT,
  location TEXT,
  lat REAL,
  lng REAL,
  FOREIGN KEY (beekeeper_id) REFERENCES beekeepers(id)
);

CREATE TABLE IF NOT EXISTS hives (
  id TEXT PRIMARY KEY,
  apiary_id TEXT NOT NULL,
  beekeeper_id TEXT NOT NULL,
  species TEXT DEFAULT 'Apis cerana',
  status TEXT DEFAULT 'ACTIVE', -- REGISTERED, ACTIVE, INSPECTION, RETIRED
  installed_at TEXT,
  FOREIGN KEY (apiary_id) REFERENCES apiaries(id),
  FOREIGN KEY (beekeeper_id) REFERENCES beekeepers(id)
);

CREATE TABLE IF NOT EXISTS sensor_readings (
  id TEXT PRIMARY KEY,
  hive_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  temperature REAL,
  humidity REAL,
  weight REAL,
  FOREIGN KEY (hive_id) REFERENCES hives(id)
);

CREATE TABLE IF NOT EXISTS health_scores (
  id TEXT PRIMARY KEY,
  hive_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  score INTEGER,
  status TEXT, -- Healthy, Attention, Critical
  reason TEXT,
  FOREIGN KEY (hive_id) REFERENCES hives(id)
);

CREATE TABLE IF NOT EXISTS yield_predictions (
  id TEXT PRIMARY KEY,
  hive_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  predicted_kg REAL,
  confidence REAL,
  explanation TEXT,
  FOREIGN KEY (hive_id) REFERENCES hives(id)
);

CREATE TABLE IF NOT EXISTS harvests (
  id TEXT PRIMARY KEY,
  hive_ids TEXT NOT NULL, -- JSON array of hive ids
  beekeeper_id TEXT NOT NULL,
  date TEXT NOT NULL,
  quantity_kg REAL NOT NULL,
  floral_source TEXT,
  location TEXT,
  FOREIGN KEY (beekeeper_id) REFERENCES beekeepers(id)
);

CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  batch_code TEXT UNIQUE NOT NULL,
  harvest_id TEXT NOT NULL,
  status TEXT DEFAULT 'CREATED', -- CREATED, RECEIVED, TESTED, PROCESSED, PACKAGED, QUARANTINED
  created_at TEXT NOT NULL,
  FOREIGN KEY (harvest_id) REFERENCES harvests(id)
);

-- The "blockchain": an append-only, hash-chained event ledger.
-- Each row's hash = SHA256(prev_hash + canonical(event fields)).
-- Tampering with any row breaks every hash after it - independently verifiable.
CREATE TABLE IF NOT EXISTS batch_events (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,     -- global sequence number (chain order) - UNIQUE so a
                                    -- race that computes a duplicate seq fails loudly
                                    -- instead of silently corrupting the chain order
  batch_id TEXT NOT NULL,
  event_type TEXT NOT NULL,       -- HARVEST_RECORDED, BATCH_CREATED, BATCH_RECEIVED, BATCH_TESTED, BATCH_PROCESSED, BATCH_PACKAGED, QR_ACTIVATED
  actor TEXT,
  payload TEXT,                   -- JSON blob of event-specific data
  timestamp TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES batches(id)
);

CREATE TABLE IF NOT EXISTS quality_tests (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  moisture REAL,
  hmf REAL,
  c4_sugar REAL,
  result TEXT, -- PASS / FAIL
  is_simulated INTEGER DEFAULT 1,
  tested_at TEXT,
  FOREIGN KEY (batch_id) REFERENCES batches(id)
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  qr_token TEXT UNIQUE NOT NULL,
  activated_at TEXT,
  FOREIGN KEY (batch_id) REFERENCES batches(id)
);

-- ── Indexes ──────────────────────────────────────────────────────────────
-- SQLite only auto-indexes PRIMARY KEY / UNIQUE columns; foreign-key columns
-- get no index by default. Irrelevant at demo scale, but correct hygiene and
-- required once this holds more than a handful of beekeepers.
CREATE INDEX IF NOT EXISTS idx_apiaries_beekeeper ON apiaries(beekeeper_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_beekeeper ON users(beekeeper_id);
CREATE INDEX IF NOT EXISTS idx_hives_beekeeper ON hives(beekeeper_id);
CREATE INDEX IF NOT EXISTS idx_hives_apiary ON hives(apiary_id);
CREATE INDEX IF NOT EXISTS idx_sensor_readings_hive ON sensor_readings(hive_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_harvests_beekeeper ON harvests(beekeeper_id);
CREATE INDEX IF NOT EXISTS idx_batches_harvest ON batches(harvest_id);
CREATE INDEX IF NOT EXISTS idx_batch_events_batch ON batch_events(batch_id, seq);
CREATE INDEX IF NOT EXISTS idx_quality_tests_batch ON quality_tests(batch_id);
CREATE INDEX IF NOT EXISTS idx_products_batch ON products(batch_id);

-- ── Append-only enforcement ──────────────────────────────────────────────
-- The ledger's trust story depends on batch_events never being modified
-- after the fact. appendEvent() in services/ledger.js already never issues
-- UPDATE/DELETE against this table - these triggers make that a database-
-- level guarantee instead of just an application convention, so even a raw
-- SQL client (or a bug elsewhere in the codebase) can't silently rewrite
-- history. The hash-chain in services/ledger.js remains a second, independent
-- line of defense: even if these triggers were dropped by someone with
-- elevated DB access, verifyChain() would still detect the tampering.
CREATE TRIGGER IF NOT EXISTS trg_batch_events_no_update
BEFORE UPDATE ON batch_events
BEGIN
  SELECT RAISE(ABORT, 'batch_events is append-only: UPDATE is not permitted');
END;

CREATE TRIGGER IF NOT EXISTS trg_batch_events_no_delete
BEFORE DELETE ON batch_events
BEGIN
  SELECT RAISE(ABORT, 'batch_events is append-only: DELETE is not permitted');
END;
