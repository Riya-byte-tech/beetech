const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const TEST_DB = path.join(__dirname, 'tmp-api.db');
process.env.HONEYCHAIN_DB_PATH = TEST_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-api-test-only';
cleanupDbFiles();

const app = require('../server');
const db = require('../db/db');
const { hashPassword } = require('../services/auth');

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

let server;
let baseUrl;

test.before(async () => {
  await new Promise(resolve => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });

  const now = new Date().toISOString();

  // Beekeeper #1 (verified) with two hives
  db.exec(`INSERT INTO beekeepers (id, name, district, state, verified) VALUES ('BK-API','API Tester','Pune','Maharashtra',1)`);
  db.exec(`INSERT INTO apiaries (id, beekeeper_id) VALUES ('AP-API','BK-API')`);
  db.exec(`INSERT INTO hives (id, apiary_id, beekeeper_id, status) VALUES ('H-API-1','AP-API','BK-API','ACTIVE')`);
  db.exec(`INSERT INTO hives (id, apiary_id, beekeeper_id, status) VALUES ('H-API-2','AP-API','BK-API','ACTIVE')`);
  db.prepare(`INSERT INTO users (id, email, password_hash, role, beekeeper_id, created_at) VALUES (?, ?, ?, 'beekeeper', 'BK-API', ?)`)
    .run('U-API-BEE', 'beekeeper@test.local', hashPassword('testpass123'), now);

  // Beekeeper #2 (UNVERIFIED) - for testing the verification gate
  db.exec(`INSERT INTO beekeepers (id, name, district, state, verified) VALUES ('BK-API-UNV','Unverified Tester','Pune','Maharashtra',0)`);
  db.exec(`INSERT INTO apiaries (id, beekeeper_id) VALUES ('AP-API-UNV','BK-API-UNV')`);
  db.exec(`INSERT INTO hives (id, apiary_id, beekeeper_id, status) VALUES ('H-API-UNV','AP-API-UNV','BK-API-UNV','ACTIVE')`);
  db.prepare(`INSERT INTO users (id, email, password_hash, role, beekeeper_id, created_at) VALUES (?, ?, ?, 'beekeeper', 'BK-API-UNV', ?)`)
    .run('U-API-UNV', 'unverified@test.local', hashPassword('testpass123'), now);

  // Lab and Admin accounts
  db.prepare(`INSERT INTO users (id, email, password_hash, role, beekeeper_id, created_at) VALUES (?, ?, ?, 'lab', NULL, ?)`)
    .run('U-API-LAB', 'lab@test.local', hashPassword('testpass123'), now);
  db.prepare(`INSERT INTO users (id, email, password_hash, role, beekeeper_id, created_at) VALUES (?, ?, ?, 'admin', NULL, ?)`)
    .run('U-API-ADMIN', 'admin@test.local', hashPassword('testpass123'), now);
});

test.after(() => {
  server.close();
  try { db.close(); } catch { /* already closed or never opened */ }
  cleanupDbFiles();
});

// Node's fetch has no automatic cookie jar (unlike a browser) - capture the
// Set-Cookie header from login and pass it back explicitly on every
// subsequent request that needs to be authenticated as that user.
async function login(email, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie, `expected a Set-Cookie header from login for ${email}`);
  return setCookie.split(';')[0]; // "honeychain_session=<token>"
}

async function request(urlPath, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

let beeCookie, unvCookie, labCookie, adminCookie;

test('logs in as each seeded role and receives a session cookie', async () => {
  beeCookie = await login('beekeeper@test.local', 'testpass123');
  unvCookie = await login('unverified@test.local', 'testpass123');
  labCookie = await login('lab@test.local', 'testpass123');
  adminCookie = await login('admin@test.local', 'testpass123');
  assert.ok(beeCookie && unvCookie && labCookie && adminCookie);
});

test('rejects requests with no session cookie at all', async () => {
  const { status } = await request('/api/hives');
  assert.strictEqual(status, 401);
});

test('rejects a harvest referencing a hive that does not exist', async () => {
  const { status, data } = await request('/api/harvests', {
    method: 'POST',
    cookie: beeCookie,
    body: { hive_ids: ['H-DOES-NOT-EXIST'], quantity_kg: 5 },
  });
  assert.strictEqual(status, 400);
  assert.match(data.error, /Unknown hive_ids/);
});

test('rejects a harvest for hives the logged-in beekeeper does not own', async () => {
  const { status, data } = await request('/api/harvests', {
    method: 'POST',
    cookie: beeCookie,
    body: { hive_ids: ['H-API-UNV'], quantity_kg: 5 }, // belongs to the OTHER beekeeper
  });
  assert.strictEqual(status, 403);
  assert.match(data.error, /do not own/);
});

test('blocks an unverified beekeeper from creating a harvest', async () => {
  const { status, data } = await request('/api/harvests', {
    method: 'POST',
    cookie: unvCookie,
    body: { hive_ids: ['H-API-UNV'], quantity_kg: 5 },
  });
  assert.strictEqual(status, 403);
  assert.match(data.error, /pending admin verification/);
});

test('a beekeeper cannot view another beekeeper\'s hive', async () => {
  const { status } = await request('/api/hives/H-API-UNV', { cookie: beeCookie });
  assert.strictEqual(status, 403);
});

test('lab role cannot list hives (not their concern)', async () => {
  const { status } = await request('/api/hives', { cookie: labCookie });
  assert.strictEqual(status, 403);
});

test('a beekeeper cannot call the lab-only advance endpoint', async () => {
  // First create a legitimate batch to try (and fail) to advance
  const harvestRes = await request('/api/harvests', {
    method: 'POST',
    cookie: beeCookie,
    body: { hive_ids: ['H-API-1'], quantity_kg: 5, floral_source: 'Mustard' },
  });
  assert.strictEqual(harvestRes.status, 201);
  const batchId = harvestRes.data.batch.id;

  const { status, data } = await request(`/api/batches/${batchId}/advance`, {
    method: 'POST',
    cookie: beeCookie,
    body: { event_type: 'BATCH_RECEIVED' },
  });
  assert.strictEqual(status, 403);
  assert.match(data.error, /requires one of these roles/);
});

let quarantineBatchId;

test('rejects quality-test before the batch has been received (out-of-order)', async () => {
  const harvestRes = await request('/api/harvests', {
    method: 'POST',
    cookie: beeCookie,
    body: { hive_ids: ['H-API-1'], quantity_kg: 5, floral_source: 'Mustard' },
  });
  quarantineBatchId = harvestRes.data.batch.id;

  const { status, data } = await request(`/api/batches/${quarantineBatchId}/quality-test`, {
    method: 'POST',
    cookie: labCookie,
    body: {},
  });
  assert.strictEqual(status, 400);
  assert.match(data.error, /must be 'RECEIVED'/);
});

test('a failed quality test quarantines the batch and blocks further progress', async () => {
  let res = await request(`/api/batches/${quarantineBatchId}/advance`, {
    method: 'POST', cookie: labCookie, body: { event_type: 'BATCH_RECEIVED' },
  });
  assert.strictEqual(res.status, 200);

  res = await request(`/api/batches/${quarantineBatchId}/quality-test`, {
    method: 'POST', cookie: labCookie, body: { moisture: 24, hmf: 95, c4_sugar: 9 },
  });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.data.new_status, 'QUARANTINED');

  res = await request(`/api/batches/${quarantineBatchId}/advance`, {
    method: 'POST', cookie: labCookie, body: { event_type: 'BATCH_PROCESSED' },
  });
  assert.strictEqual(res.status, 400);
  assert.match(res.data.error, /quarantined/i);
});

test('full happy path: received -> tested (pass) -> processed -> packaged', async () => {
  let res = await request('/api/harvests', {
    method: 'POST', cookie: beeCookie,
    body: { hive_ids: ['H-API-2'], quantity_kg: 6, floral_source: 'Litchi' },
  });
  assert.strictEqual(res.status, 201);
  const batchId = res.data.batch.id;

  res = await request(`/api/batches/${batchId}/advance`, { method: 'POST', cookie: labCookie, body: { event_type: 'BATCH_RECEIVED' } });
  assert.strictEqual(res.status, 200);

  res = await request(`/api/batches/${batchId}/quality-test`, { method: 'POST', cookie: labCookie, body: { moisture: 17, hmf: 20, c4_sugar: 2 } });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.data.new_status, 'TESTED');

  res = await request(`/api/batches/${batchId}/advance`, { method: 'POST', cookie: labCookie, body: { event_type: 'BATCH_PROCESSED' } });
  assert.strictEqual(res.status, 200);

  res = await request(`/api/batches/${batchId}/activate-qr`, { method: 'POST', cookie: labCookie, body: {} });
  assert.strictEqual(res.status, 201);
  assert.ok(res.data.product.qr_token);

  // Beekeeper cannot perform lab actions even on their own batch
  const denied = await request(`/api/batches/${batchId}/advance`, { method: 'POST', cookie: beeCookie, body: { event_type: 'BATCH_RECEIVED' } });
  assert.strictEqual(denied.status, 403);
});

test('only admin can view/approve pending beekeepers', async () => {
  let res = await request('/api/admin/beekeepers?status=pending', { cookie: labCookie });
  assert.strictEqual(res.status, 403);

  res = await request('/api/admin/beekeepers?status=pending', { cookie: adminCookie });
  assert.strictEqual(res.status, 200);
  assert.ok(res.data.some(b => b.id === 'BK-API-UNV'));
});

test('admin approval unblocks a previously-unverified beekeeper', async () => {
  let res = await request('/api/admin/beekeepers/BK-API-UNV/verify', { method: 'POST', cookie: adminCookie });
  assert.strictEqual(res.status, 200);

  res = await request('/api/harvests', {
    method: 'POST',
    cookie: unvCookie,
    body: { hive_ids: ['H-API-UNV'], quantity_kg: 3 },
  });
  assert.strictEqual(res.status, 201);
});

test('the public consumer verify endpoint needs no auth at all', async () => {
  const res = await fetch(`${baseUrl}/api/verify/does-not-matter`);
  // 404 (batch not found) is fine here - the point is it's NOT 401
  assert.notStrictEqual(res.status, 401);
});

test('the whole ledger is still internally consistent after all of the above', async () => {
  const { status, data } = await request('/api/ledger', { cookie: adminCookie });
  assert.strictEqual(status, 200);
  assert.strictEqual(data.integrity.valid, true);
});
