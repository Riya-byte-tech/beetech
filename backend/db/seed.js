require('dotenv').config();
const db = require('./db');
const { v4: uuidv4 } = require('uuid');
const { generateReadings } = require('../services/simulator');
const { hashPassword } = require('../services/auth');

const DEMO_PASSWORD = {
  beekeeper: 'beekeeper123',
  lab: 'lab123456',
  admin: 'admin12345',
};

/**
 * IMPORTANT: this script is idempotent PER ACCOUNT, not "skip entirely if
 * anything exists." An earlier version bailed out if the `users` table had
 * ANY rows at all - which meant if someone registered their own account
 * through the app before ever running `npm run seed`, every demo account
 * (including lab/admin, which only exist via this script) silently never
 * got created, and `npm run seed` gave no useful signal that anything was
 * wrong. Safe to re-run this at any time, in any order, against any existing
 * database - it only ever fills in what's missing.
 */

function ensureBeekeeper({ id, name, district, state, phone, verified }) {
  const exists = db.prepare('SELECT id FROM beekeepers WHERE id = ?').get(id);
  if (exists) return false;
  db.prepare(`
    INSERT INTO beekeepers (id, name, district, state, phone, verified)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name, district, state, phone, verified);
  return true;
}

function ensureApiary({ id, beekeeperId, name, location, lat, lng }) {
  const exists = db.prepare('SELECT id FROM apiaries WHERE id = ?').get(id);
  if (exists) return false;
  db.prepare(`
    INSERT INTO apiaries (id, beekeeper_id, name, location, lat, lng)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, beekeeperId, name, location || null, lat || null, lng || null);
  return true;
}

function ensureUser({ id, email, password, role, beekeeperId }) {
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return false;
  db.prepare(`
    INSERT INTO users (id, email, password_hash, role, beekeeper_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, email, hashPassword(password), role, beekeeperId || null, new Date().toISOString());
  return true;
}

function ensureHiveWithReadings(hiveId, apiaryId, beekeeperId, profile) {
  const exists = db.prepare('SELECT id FROM hives WHERE id = ?').get(hiveId);
  if (exists) return false;

  db.prepare(`
    INSERT INTO hives (id, apiary_id, beekeeper_id, species, status, installed_at)
    VALUES (?, ?, ?, 'Apis cerana', 'ACTIVE', ?)
  `).run(hiveId, apiaryId, beekeeperId, new Date().toISOString());

  const insertReading = db.prepare(`
    INSERT INTO sensor_readings (id, hive_id, timestamp, temperature, humidity, weight)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const readings = generateReadings(hiveId, 24, profile);
  const insertAll = db.transaction(() => {
    for (const r of readings) {
      insertReading.run(uuidv4(), hiveId, r.timestamp, r.temperature, r.humidity, r.weight);
    }
  });
  insertAll();
  return true;
}

function run() {
  const created = [];
  const skipped = [];
  const note = (label, wasCreated) => (wasCreated ? created : skipped).push(label);

  // ── Beekeeper #1: Ramesh Patil - pre-verified, so the main demo works
  // immediately without needing an approval step first. ────────────────────
  note('beekeeper profile: Ramesh Patil', ensureBeekeeper({
    id: 'BK-RAMESH', name: 'Ramesh Patil', district: 'Pune', state: 'Maharashtra', phone: '9800000000', verified: 1,
  }));
  note('apiary: AP-MAIN', ensureApiary({
    id: 'AP-MAIN', beekeeperId: 'BK-RAMESH', name: 'Main Apiary', location: 'Pune, Maharashtra', lat: 18.5204, lng: 73.8567,
  }));
  note('login: ramesh@honeychain.demo', ensureUser({
    id: 'U-RAMESH', email: 'ramesh@honeychain.demo', password: DEMO_PASSWORD.beekeeper, role: 'beekeeper', beekeeperId: 'BK-RAMESH',
  }));

  const hiveProfiles = [
    ['H-001', 'healthy'], ['H-002', 'healthy'], ['H-003', 'healthy'],
    ['H-004', 'healthy'], ['H-005', 'attention'], ['H-006', 'critical'],
  ];
  for (const [hiveId, profile] of hiveProfiles) {
    note(`hive: ${hiveId}`, ensureHiveWithReadings(hiveId, 'AP-MAIN', 'BK-RAMESH', profile));
  }

  // ── Beekeeper #2: Sunita Kale - deliberately left UNVERIFIED, so there's
  // something for the admin account to approve during a demo without having
  // to register a brand-new account live first. ────────────────────────────
  note('beekeeper profile: Sunita Kale', ensureBeekeeper({
    id: 'BK-SUNITA', name: 'Sunita Kale', district: 'Nashik', state: 'Maharashtra', phone: '9900011122', verified: 0,
  }));
  note('apiary: AP-NASHIK', ensureApiary({
    id: 'AP-NASHIK', beekeeperId: 'BK-SUNITA', name: 'Nashik Apiary', location: 'Nashik, Maharashtra',
  }));
  note('login: sunita@honeychain.demo', ensureUser({
    id: 'U-SUNITA', email: 'sunita@honeychain.demo', password: DEMO_PASSWORD.beekeeper, role: 'beekeeper', beekeeperId: 'BK-SUNITA',
  }));

  // ── Lab and Admin accounts - provisioned here, not via any in-app UI
  // (Decision: manual/seed-script is fine for staff accounts). ─────────────
  note('login: lab@honeychain.demo', ensureUser({
    id: 'U-LAB', email: 'lab@honeychain.demo', password: DEMO_PASSWORD.lab, role: 'lab',
  }));
  note('login: admin@honeychain.demo', ensureUser({
    id: 'U-ADMIN', email: 'admin@honeychain.demo', password: DEMO_PASSWORD.admin, role: 'admin',
  }));

  console.log(`Seed run complete. Created ${created.length}, already present ${skipped.length}.`);
  if (created.length > 0) {
    console.log('  Newly created: ' + created.join(', '));
  }

  // Always print credentials, regardless of what was newly created vs already
  // there - this is the one thing that must never silently disappear.
  console.log('\nDemo login credentials:');
  console.log('------------------------------------------------------------');
  console.log('  Beekeeper (verified):    ramesh@honeychain.demo / beekeeper123');
  console.log('  Beekeeper (unverified):  sunita@honeychain.demo / beekeeper123');
  console.log('  Lab / Processing:        lab@honeychain.demo    / lab123456');
  console.log('  Cluster Admin:           admin@honeychain.demo  / admin12345');
  console.log('------------------------------------------------------------');
}

run();
