# Honey Chain — MVP Architecture (as built)

**Team Odysseus · SIH 2026 · PS 26021**

This document freezes what we've actually built, as a reference for the team and
for demo prep. It should be read alongside `docs/mvp.txt` (the scope decision that
produced this build) and the research docs (`docs/understanding_our_chosen_problem_statement.md`,
`docs/related-works-and-sources.txt`, `docs/deep-search_honeyChain.txt`), which explain *why*
each design choice was made.

> **One sentence:** A three-role login system (Beekeeper, Lab, Cluster Admin) gates
> a vertical slice of the honey supply chain — a verified beekeeper monitors a hive
> with simulated IoT data, gets an AI-assisted health/yield insight, records a
> harvest, which becomes a honey batch anchored to a tamper-evident hash-chained
> ledger, moves through lab processing and a simulated quality test, and is packaged
> with a QR code that any consumer (no login needed) scans to see the full verified
> provenance journey — including a live integrity check.

---

## 1. What this MVP proves

Four demo capabilities, matching PS 26021's core asks:

```text
1. ACCESS CONTROL         →  3 roles, server-enforced, admin-gated beekeeper verification
2. TRACEABLE BATCH        →  Harvest → Batch → hash-chained ledger events
3. SMART HIVE             →  Simulated sensors → AI health score + yield prediction
4. CONSUMER VERIFICATION  →  QR → provenance journey → live integrity check
```

Everything else from the research phase (Madhukranti/KVIC integration, FPO
marketplace, real lab APIs, batch split/merge genealogy, trained ML models, real
IoT hardware) is **deliberately out of scope** — see Section 10.

---

## 2. System architecture

```text
                         ┌───────────────────────────┐
                         │        FRONTEND            │
                         │   React + Vite (SPA)       │
                         │   AuthContext + cookie      │
                         │                             │
                         │  /login, /register           │
                         │  /beekeeper*    (role: beekeeper)│
                         │  /admin         (role: lab)   │
                         │  /cluster, /ledger,            │
                         │  /admin/approvals (role: admin) │
                         │  /scan          (public)         │
                         └──────────────┬──────────────────┘
                                        │  fetch('/api/...', credentials:'include')
                                        │  (Vite dev proxy → :4000)
                                        ▼
                         ┌────────────────────────────────┐
                         │        BACKEND                   │
                         │   Node.js + Express                │
                         │                                     │
                         │  middleware/auth.js                  │
                         │   └─ requireAuth, requireRole(...)     │
                         │                                          │
                         │  routes/                                  │
                         │   ├─ auth.js, admin.js (login/approve)      │
                         │   ├─ hives.js, harvests.js (owner-scoped)     │
                         │   ├─ batches.js, quality.js (lab-only writes)  │
                         │   ├─ alerts.js, ledger.js (admin-only)           │
                         │   └─ products.js, certificate.js (+public verify)│
                         │                                                   │
                         │  services/                                        │
                         │   ├─ auth.js     (scrypt + HMAC tokens)              │
                         │   ├─ ledger.js   (hash-chain)                         │
                         │   ├─ batchStateMachine.js (pipeline order)             │
                         │   ├─ ai.js       (health/yield)                         │
                         │   └─ simulator.js (mock IoT)                              │
                         └──────────────┬───────────────────────────────────────────┘
                                        │
                                        ▼
                         ┌───────────────────────────┐
                         │      SQLite (node:sqlite)   │
                         │   built into Node 22.5+      │
                         │   — no native compilation     │
                         └───────────────────────────┘
```

**Why these choices:**

| Decision | Reasoning |
|---|---|
| SQLite via `node:sqlite` | Zero native dependencies (no node-gyp/Visual Studio pain, per our own Windows setup experience). Trivial to swap for Postgres later since all access goes through `db.prepare(...)`. |
| Hash-chained ledger instead of a real blockchain | Research finding: blockchain's *value* here is tamper-evidence + auditability, not decentralization. A real hash-chain gives an honest, independently verifiable integrity guarantee without standing up a testnet for a hackathon demo. Interface is designed to be swapped for a Solidity contract later without touching any route. |
| Custom crypto-only auth instead of Passport/bcrypt/jsonwebtoken | Same zero-native-dependency philosophy as `node:sqlite`. `scrypt` + HMAC via Node's built-in `crypto` module - ~100 lines, fully readable, nothing to fail to compile. See Section 4. |
| httpOnly cookie instead of localStorage for the session token | Client-side JS (including any injected via an XSS bug elsewhere) cannot read an httpOnly cookie - meaningfully harder to exfiltrate a session than a `localStorage` token. |
| Rule-based AI instead of a trained model | Research finding: the PS explicitly warns against over-claiming disease diagnosis. Transparent thresholds are more defensible in judging than a black-box model with no real training data behind it yet. |
| Simulated IoT instead of real hardware first | De-risks the demo (hardware can fail 5 minutes before judging — this was flagged explicitly in `docs/mvp.txt`). The data shape is real; only the source is mocked. |

---

## 3. Data model

```text
User (login account: email, password_hash, role)
   │
   │ role='beekeeper' links to exactly one:
   ▼
Beekeeper (verified: 0|1)
   │
   ▼
 Apiary
   │
   ▼
  Hive ──────────────┐
   │                 │
   ▼                 ▼
SensorReading   (feeds AI: health score, yield prediction)
   │
   ▼
Harvest (hive_ids[], quantity_kg, floral_source)
   │
   ▼
Batch (batch_code, status)
   │
   ├── batch_events   (the ledger — append-only, hash-chained)
   ├── quality_tests  (simulated lab record)
   └── products       (QR token, activation)
```

### Entity summary (see `backend/db/schema.sql` for full DDL)

| Table | Purpose |
|---|---|
| `users` | Login accounts: email, `password_hash`, `role` (beekeeper/lab/admin), `beekeeper_id` (only set for role=beekeeper) |
| `beekeepers` | Beekeeper *profile* (name, district, state) + `verified` flag - separate from `users` because a lab/admin login has no beekeeper profile at all |
| `apiaries` | Location grouping of hives |
| `hives` | Physical hive identity, species, status |
| `sensor_readings` | Time-series temp/humidity/weight (simulated or real) |
| `harvests` | Links hive(s) → quantity extracted on a date |
| `batches` | The traceable unit; carries `status` and a human-readable `batch_code` |
| `batch_events` | **The ledger.** Append-only, hash-chained, one row per lifecycle event |
| `quality_tests` | Simulated FSSAI-style lab record (moisture/HMF/C4 sugar) |
| `products` | QR token + activation timestamp, one per packaged batch |

**Why `users` and `beekeepers` are separate tables, not one:** a login account
and a beekeeper business-profile are different concepts that happen to coincide
for the beekeeper role. A lab or admin user needs the former with none of the
latter. This also means a beekeeper's profile data (name, district, verification
status) can exist and be referenced by hives/harvests independent of whatever
identity/session system sits in front of it - useful if this were ever
integrated with a real Madhukranti/KVIC identity provider instead of our own
login table.

**Batch status lifecycle:**

```text
CREATED → RECEIVED → TESTED → PROCESSED → PACKAGED
              │
              └──(fail)──→ QUARANTINED  (terminal — cannot advance)
```

**Beekeeper verification lifecycle:**

```text
Registers (POST /api/auth/register)
        │
        ▼
  verified = 0  ──can register hives, cannot record harvests──┐
        │                                                      │
        │ Cluster Admin approves                               │
        │ (POST /api/admin/beekeepers/:id/verify)               │
        ▼                                                      │
  verified = 1  ──requireVerifiedBeekeeper now passes───────────┘
```

**Referential integrity:** `PRAGMA foreign_keys = ON` is set in `db.js`, and
every child table has a real `FOREIGN KEY` constraint — `hives→apiaries`,
`hives→beekeepers`, `harvests→beekeepers`, `batches→harvests`,
`batch_events→batches`, `quality_tests→batches`, `products→batches`,
`users→beekeepers`. The one exception is `harvests.hive_ids`, which is a JSON
array (a harvest can span multiple hives) and therefore can't be a real FK
column — `POST /api/harvests` checks each hive ID exists and belongs to the
given beekeeper before inserting, since SQLite can't do that check for us here.

**Indexes** beyond the automatic primary-key indexes exist on every foreign-key
column (`hives.beekeeper_id`, `batch_events.batch_id`, `sensor_readings.hive_id`,
`users.email`, `users.beekeeper_id`, etc.) — irrelevant at demo scale, but
correct hygiene and necessary once this holds more than a handful of beekeepers.

---

## 4. Authentication & role-based access control

Three roles, mapped directly onto the pages/actions that already existed:
**beekeeper** (own hives/harvests), **lab** (batch pipeline, cross-beekeeper),
**admin** (cluster-wide oversight + approvals). Consumers need no account at
all - the public verify/certificate routes never import the auth middleware.

### Session mechanism

`services/auth.js` implements two primitives using only Node's built-in
`crypto` module - no `bcrypt`, no `jsonwebtoken`, no native dependencies:

- **Password hashing**: `scrypt` with a random 16-byte salt per user, stored as
  a self-describing string (`scrypt:<N>:<salt>:<hash>`) so the algorithm or
  cost parameter could change later without invalidating existing hashes.
- **Session tokens**: a JWT-*shaped* token (`header.payload.signature`,
  base64url, HMAC-SHA256) - same structural guarantees as a real JWT
  (server-signed, tamper-evident, carries an expiry) implemented in ~60 lines
  rather than pulled in as a dependency. `verifyToken` uses
  `crypto.timingSafeEqual` for the signature comparison specifically to avoid
  timing side-channel attacks on the check itself.

The token is set as an **httpOnly cookie** (`routes/auth.js`, cookie name
`honeychain_session`) - never exposed to client-side JavaScript, which is the
actual point of using a cookie over `localStorage` (an XSS bug elsewhere in the
app can't be used to steal the session token if it does that). `sameSite`/
`secure` flags adapt based on `NODE_ENV` (see Section 13's deployment notes).

### Middleware (`backend/middleware/auth.js`)

- `requireAuth` - parses the cookie (a ~15-line manual parser; not worth a
  dependency), verifies the token, loads the current user from `users`, and
  attaches `req.user = { id, email, role, beekeeper_id }`. Every protected
  route file calls this via `router.use(requireAuth)` at the top, so it's
  obvious from reading any route file whether it's protected.
- `requireRole(...roles)` - simple allow-list check against `req.user.role`.
- `requireVerifiedBeekeeper` - the actual enforcement point behind the
  "verified beekeeper" badge shown throughout the UI. Used only on
  `POST /api/harvests` - a beekeeper can register hives and watch sensor data
  pre-verification, but cannot enter anything into the traceability ledger
  until a Cluster Admin approves them.

### What's scoped by ownership, not just role

Role alone isn't enough - a beekeeper role also has to be restricted to *their
own* data:

- `GET /api/hives`, `GET /api/hives/:id` - a beekeeper only ever sees hives
  where `hive.beekeeper_id === req.user.beekeeper_id`; a mismatch is a 403,
  not a filtered-empty-result (so the boundary is visible/testable, not silent).
- `POST /api/hives`, `POST /api/harvests` - `beekeeper_id`/`apiary_id` are
  **always** resolved server-side from `req.user`, never trusted from the
  request body. Earlier in this project's history, the client passed
  `beekeeper_id` directly in the request - trivially spoofable. That's gone now.
- `GET /api/batches`, `GET /api/batches/:id` - beekeepers see only batches
  whose harvest belongs to them; lab/admin see all batches (lab genuinely needs
  cross-beekeeper visibility to do their job).

### Route → role matrix

| Route | Beekeeper | Lab | Admin | Public |
|---|---|---|---|---|
| `POST /api/auth/register`, `/login` | - | - | - | ✅ |
| `GET /api/hives*`, `POST /api/hives*` | ✅ (own only) | ❌ | 👁 (read, all) | ❌ |
| `POST /api/harvests` | ✅ (if verified) | ❌ | ❌ | ❌ |
| `GET /api/batches*` | 👁 (own only) | ✅ | ✅ | ❌ |
| `POST /api/batches/:id/advance`, `/quality-test`, `/activate-qr` | ❌ | ✅ | ❌ | ❌ |
| `GET /api/alerts`, `GET /api/ledger` | ❌ | ❌ | ✅ | ❌ |
| `GET/POST /api/admin/beekeepers*` | ❌ | ❌ | ✅ | ❌ |
| `GET /api/verify/:qrToken*` | - | - | - | ✅ |

This matrix is enforced in the actual route files, not just documented here -
`test/api.test.js` exercises most of these cells directly (see Section 13).

---

## 5. The ledger — how "blockchain" actually works here


Implemented in `backend/services/ledger.js`. This is a real, functioning
hash-chain, not a decorative label:

```text
event N's hash = SHA256( event(N-1).hash + canonical(event N's fields) )
```

- `appendEvent()` is the **only** way rows are ever written to `batch_events` —
  never UPDATE or DELETE. This is now enforced at two independent layers:
  1. **Database-level**: `BEFORE UPDATE`/`BEFORE DELETE` triggers on
     `batch_events` (in `schema.sql`) reject any direct edit outright, even
     from a raw SQL client bypassing the application entirely.
  2. **Cryptographic**: even if an attacker had elevated DB access and dropped
     those triggers first, `verifyChain()` (below) would still catch the
     tampering independently. Neither layer depends on the other.
- `verifyChain()` recomputes every hash from genesis (`'0'.repeat(64)`) and
  compares against what's stored. Any tampering — even a single character in one
  event's payload — is detected and the exact broken event is named.
- We proved both layers during development: a direct `UPDATE` against
  `batch_events` throws `batch_events is append-only: UPDATE is not permitted`
  and never touches the row; and separately, dropping that trigger first and
  then corrupting a row's `payload` causes `verifyChain()` to correctly flag
  that exact `seq` number as broken, while everything before and after
  remains valid.

**Concurrency: the read-then-write in `appendEvent` is atomic against
concurrent writers, not just against tampering.** Computing the next `seq`
and `prev_hash` requires reading the last event before writing the new one -
without protection, two concurrent appends could both read the same "last
event" and compute the same seq/prev_hash, corrupting the chain's ordering.
Three layers guard against this, from cheapest to most fundamental:

1. `batch_events.seq` has a `UNIQUE` constraint (`schema.sql`) - a duplicate
   seq fails loudly with a constraint violation instead of silently landing.
2. `appendEvent`'s read and write are wrapped in a single `BEGIN IMMEDIATE`
   transaction (`db.transaction(fn, { immediate: true })` in `db.js`), which
   takes SQLite's write lock *before* the read rather than at the first write
   statement - a second writer is blocked until this transaction commits,
   rather than racing it.
3. `PRAGMA busy_timeout = 5000` (`db.js`) makes a blocked writer wait up to
   5s for the lock rather than failing immediately with `SQLITE_BUSY`.

This matters more than it might seem for a single-server demo: within one
Node process, JS's run-to-completion model plus a synchronous SQLite driver
already happens to serialize this (there's no `await` between the read and
write), but that's an implicit property that a future `await` could silently
break, and it doesn't hold at all across multiple processes (Node cluster,
PM2 cluster mode, multiple containers - all standard ways to scale this app).
`test/ledger-concurrency.test.js` proves the fix with genuine OS-level
concurrency: it spawns several real child processes that all race to append
to the same batch simultaneously, then asserts the resulting `seq` sequence
has no gaps or duplicates and the whole chain still verifies. A same-process
`Promise.all()` test would not actually exercise this - see that file's
comments for why.

**Event vocabulary currently implemented:**

```text
HARVEST_RECORDED → BATCH_CREATED → BATCH_RECEIVED → BATCH_TESTED (or BATCH_FAILED)
→ BATCH_PROCESSED → QR_ACTIVATED
```

This is a subset of the fuller event vocabulary proposed in
`docs/deep-search_honeyChain.txt` (Section 29) — deliberately trimmed to what the MVP
demo needs.

**On-chain vs off-chain**, per the research recommendation:

| On-chain (in `batch_events`) | Off-chain (in regular tables) |
|---|---|
| Event type, actor, timestamp, hashes | Raw sensor telemetry |
| Batch/harvest/hive IDs | Full quality-test parameter sets |
| Quality result (PASS/FAIL) | — |

---

## 6. Batch state machine — server-side enforcement

Implemented in `backend/services/batchStateMachine.js`. An early version of
this MVP only gated pipeline buttons in the frontend — a direct API call
(Postman, curl, or a bug elsewhere) could skip straight from `CREATED` to
`PACKAGED`, bypassing quality testing entirely. This is now enforced
server-side, in one place, used by every route that changes a batch's status:

```text
CREATED → RECEIVED → TESTED → PROCESSED → PACKAGED
              │
              └──(fail)──→ QUARANTINED  (terminal — every route rejects further transitions)
```

- `assertAdvance(batch, eventType)` — used by `POST /batches/:id/advance`
- `assertQualityTest(batch)` — used by `POST /batches/:batchId/quality-test`
- `assertActivateQr(batch)` — used by `POST /batches/:batchId/activate-qr`

All three are pure functions (`{ status } → void | throws`), so they're
unit-tested directly with no database involved (see Section 13).

## 7. AI layer

Implemented in `backend/services/ai.js`. Two functions, both clearly labeled as
predictions/heuristics — never diagnoses:

### `computeHealthScore(readings)`
- Rule-based scoring against normal ranges (temp 30–36°C, humidity 50–70%) plus a
  weight-trend check across the reading history.
- Output: `{ score: 0-100, status: Healthy|Attention|Critical, reason, flag }`
- Critical/Attention outputs include an explicit recommendation to inspect —
  never a disease name. This mirrors the NBB guidance found in research: AI should
  flag risk, not replace expert diagnosis.

### `predictYield(readings, healthScore)`
- Heuristic: harvestable yield ≈ 55% of observed weight gain, scaled down if the
  hive's health score is low.
- Output includes an explicit `confidence` percentage — always presented as a
  prediction in the UI, never a guarantee.

### `services/simulator.js`
- Generates 24 hours of readings per hive along three named profiles —
  `healthy`, `attention`, `critical` — tuned so each reliably produces the
  corresponding health status regardless of random jitter (useful for a
  predictable demo).
- This is the single component intended to be replaced by real hardware later
  (see below) — everything downstream only depends on the shape of a
  `sensor_readings` row, not its source.

---

## 8. API reference

All routes under `/api`. Full detail in `backend/routes/*.js`. Auth requirement
noted per route; see Section 4 for the full role matrix.

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /health` | none | Liveness check |
| `POST /auth/register` | none | Beekeeper self-registration (creates user + beekeeper + apiary, unverified) |
| `POST /auth/login`, `/auth/logout` | none | Session cookie issue/clear |
| `GET /auth/me` | any | Restore session on frontend load |
| `GET /admin/beekeepers?status=` | admin | List beekeepers by verification status |
| `POST /admin/beekeepers/:id/verify` | admin | Approve a pending beekeeper |
| `GET/POST /hives` | beekeeper (own)/admin (all) | List / register a hive - `beekeeper_id` always from session |
| `GET /hives/:id` | beekeeper (own)/admin | Full detail: readings + AI health + yield prediction |
| `POST /hives/:id/simulate` | beekeeper (own) | Regenerate readings under a named profile (demo control) |
| `POST /harvests` | beekeeper (own, **verified only**) | Records harvest **and** creates the batch; writes 2 ledger events |
| `GET /batches`, `/batches/:id` | beekeeper (own)/lab/admin | List / full detail incl. ledger events, tests, product |
| `GET /batches/code/:code` | beekeeper (own)/lab/admin | Lookup by human-readable batch code |
| `POST /batches/:id/advance` | **lab only** | Manual pipeline step (`BATCH_RECEIVED`, `BATCH_PROCESSED`) |
| `GET /batches/:id/verify` | beekeeper (own)/lab/admin | Recomputes and reports **global** ledger integrity |
| `POST /batches/:batchId/quality-test` | **lab only** | Simulated lab test against FSSAI-style thresholds; quarantines on fail |
| `POST /batches/:batchId/activate-qr` | **lab only** | Packages the batch, generates QR image, writes `QR_ACTIVATED` event |
| `GET /batches/:id/certificate` | beekeeper (own)/lab/admin | PDF certificate by internal batch ID |
| `GET /alerts` | **admin only** | Cross-hive flagged-hive feed, all beekeepers |
| `GET /ledger` | **admin only** | Whole-system event timeline + integrity check |
| `GET /verify/:qrToken` | none (public) | Consumer endpoint — provenance + journey + live integrity check |
| `GET /verify/:qrToken/certificate` | none (public) | PDF certificate by QR token |

---

## 9. Frontend

React + Vite SPA. `AuthContext` (`src/context/AuthContext.jsx`) restores the
session on load via `GET /api/auth/me`, and every non-public route is wrapped in
`<ProtectedRoute roles={[...]}>` (`src/components/ProtectedRoute.jsx`), which
redirects to `/login` if unauthenticated or to the user's own role-home if
they're logged in but hit a route their role doesn't cover.

```text
/login, /register             → Public. Register creates a beekeeper account,
                                 auto-logs-in, shows "pending verification" message.

/beekeeper                    → role: beekeeper. Apiary overview + hive list,
                                 with a pending-verification banner if unverified.
/beekeeper/hives/:hiveId      → role: beekeeper. Sensor readings, AI insight,
                                 "Record Harvest" (disabled until verified),
                                 live profile-switch buttons for demo purposes.

/admin                        → role: lab. Batch pipeline: select a batch, walk it
                                 through Received → Quality Test (Pass/Force-Fail)
                                 → Processed → Package & Activate QR; shows the
                                 ledger journey with truncated hashes.

/cluster                      → role: admin. Cross-hive alerts, all beekeepers.
/ledger                       → role: admin. Whole-system event timeline.
/admin/approvals              → role: admin. Approve pending beekeeper registrations.

/scan, /scan/:qrToken         → Fully public, no login. Paste or scan a batch code,
                                 see origin, harvest detail, quality result, full
                                 traceability journey, and the live integrity check.
```

The nav bar (`TopBar.jsx`) only renders links the logged-in role actually has
access to - a lab account never even sees a "Cluster Alerts" link to click.
This is a UX nicety, not the security boundary; the actual enforcement is
server-side (Section 4) and is what the tests in Section 13 exercise.

Shared styling in `src/index.css` (warm amber/honey theme). API calls centralized
in `src/api.js`, which sends `credentials: 'include'` on every request so the
httpOnly session cookie round-trips correctly through Vite's dev proxy.

---

## 10. Explicitly out of scope for this MVP

Carried over from `docs/mvp.txt`, unchanged:

| Feature | Status |
|---|---|
| Real blockchain network (testnet/mainnet contract) | ❌ (hash-chain stands in) |
| FPO / marketplace layer | ❌ |
| Real laboratory API integration | ❌ (simulated record only) |
| Madhukranti / KVIC Honey MIS integration | ❌ (architected to allow later) |
| Batch split / merge genealogy | ❌ (schema allows; not exposed in UI) |
| Trained ML disease/yield models | ❌ (rule-based heuristics only) |
| Real IoT hardware | ❌ (simulation mode; see roadmap below) |
| In-app staff (lab/admin) account management | ❌ (seed script only - see Section 4) |
| Email verification / password reset | ❌ (not needed for a demo deployment) |

**Now in scope, previously listed here as deferred:** real login with three
roles, server-side ownership/role enforcement, and a beekeeper-verification
approval workflow. See Section 4.

---

## 11. Extension points (designed-in, not yet built)

These were kept in mind while building so the MVP doesn't need a rewrite later:

- **Real IoT**: add `POST /api/hives/:id/readings` accepting the same row shape
  `simulator.js` already produces; point an ESP32 (DHT22 + load cell) at it. No
  change needed to `ai.js`, the dashboard, or anything downstream — the AI layer
  is IoT-source-agnostic by design.
- **Real blockchain**: `services/ledger.js`'s two functions (`appendEvent`,
  `verifyChain`) are the entire interface every route depends on. Swapping the
  internals for a Solidity contract call (e.g. on Polygon) means editing one file.
- **Batch genealogy**: `batches` table and event vocabulary already anticipate
  split/merge (see `docs/deep-search_honeyChain.txt` §15); just needs UI + a couple of
  new event types (`BATCH_SPLIT`, `BATCH_MERGED`).
- **Government integration**: `beekeepers.id` and `hives.id` are plain strings
  specifically so they can later be swapped for Madhukranti/KVIC-issued IDs
  without a schema change.
- **Staff account management UI**: `POST /api/admin/beekeepers/:id/verify`
  already establishes the pattern (admin-only route mutating another user's
  access); an equivalent `POST /api/admin/users` for creating lab accounts
  in-app is a small addition to `routes/admin.js`, not an architecture change.
- **Vetted auth library**: `services/auth.js`'s `hashPassword`/`verifyPassword`/
  `signToken`/`verifyToken` are the only functions anything else calls: swapping
  the internals for `bcrypt` + `jsonwebtoken` (or a session-store-backed
  approach) touches one file.

---

## 12. Project file structure

```text
honey-chain-mvp/
├── README.md                 # setup + demo script
├── mvp-architecture.md       # this file
├── backend/
│   ├── .env.example           # JWT_SECRET, PORT, NODE_ENV, FRONTEND_ORIGIN
│   ├── package.json
│   ├── server.js              # Express entrypoint; exports `app` for tests, listens when run directly
│   ├── db/
│   │   ├── schema.sql          # full DDL: 10 tables (incl. `users`) + indexes + append-only triggers
│   │   ├── db.js               # node:sqlite connection + transaction shim (path configurable via env)
│   │   └── seed.js             # demo accounts for all 3 roles + Ramesh Patil's 6 hives
│   ├── middleware/
│   │   └── auth.js              # requireAuth, requireRole(...), requireVerifiedBeekeeper
│   ├── services/
│   │   ├── auth.js                 # password hashing (scrypt) + session tokens (HMAC) - crypto only
│   │   ├── ledger.js                 # hash-chained event ledger
│   │   ├── batchStateMachine.js       # server-side transition rules (pure functions)
│   │   ├── ai.js                       # health score + yield prediction
│   │   ├── simulator.js                 # mock IoT sensor generator
│   │   ├── hiveEnrichment.js             # shared health/yield enrichment (hives.js + alerts.js)
│   │   └── certificatePdf.js              # shared PDF rendering (admin + public verify routes)
│   ├── routes/
│   │   ├── auth.js                # register/login/logout/me
│   │   ├── admin.js                # beekeeper listing + approval (admin only)
│   │   ├── hives.js                 # ownership-scoped; beekeeper_id always from session
│   │   ├── harvests.js               # validates hive/beekeeper existence; requireVerifiedBeekeeper
│   │   ├── batches.js                 # advance uses batchStateMachine; lab only
│   │   ├── quality.js                  # quality-test uses batchStateMachine; lab only
│   │   ├── products.js                  # QR activation (lab only, state-checked) + public verify
│   │   ├── certificate.js                # PDF certificate, ownership-checked + public routes
│   │   ├── alerts.js                      # cluster-wide flagged-hive feed (admin only)
│   │   └── ledger.js                       # global ledger explorer endpoint (admin only)
│   └── test/
│       ├── batchStateMachine.test.js         # pure unit tests, no DB
│       ├── ledger.test.js                     # trigger + hash-chain tamper detection
│       └── api.test.js                         # full HTTP integration tests incl. auth/RBAC
└── frontend/
    └── src/
        ├── api.js                  # fetch wrapper, credentials:'include' on every call
        ├── App.jsx                  # router incl. ProtectedRoute wrapping per role
        ├── index.css                 # honey/amber theme
        ├── context/AuthContext.jsx    # session restore, login/register/logout
        ├── components/
        │   ├── TopBar.jsx               # role-aware nav + logout
        │   └── ProtectedRoute.jsx        # redirects based on auth/role state
        └── pages/
            ├── LoginPage.jsx / RegisterPage.jsx
            ├── BeekeeperDashboard.jsx      # own hives only; verification banner
            ├── HiveDetail.jsx               # "Record Harvest" disabled if unverified
            ├── AdminBatchPipeline.jsx        # role: lab
            ├── ConsumerScan.jsx               # public, unchanged
            ├── ClusterAlerts.jsx               # role: admin
            ├── LedgerExplorer.jsx               # role: admin
            └── AdminApprovals.jsx                # role: admin - approve pending beekeepers
```

---

## 13. The demo script (hero workflow) and automated tests

0. **Register a new beekeeper** at `/register`, then **log in as Admin** and
   approve them from the Approvals tab (or approve the pre-seeded
   `sunita@honeychain.demo`, already pending) — this is the new opening beat,
   establishing that the trust chain starts at registration, not at the ledger.
1. **Log in as Beekeeper** → open a healthy hive and a critical hive side by
   side; show the AI health score and yield prediction reacting live via the
   "Simulate: Critical" button.
2. **Record Harvest** on a hive → batch is created, two events land on the
   ledger immediately. (Try this on the *unverified* account first to show it's
   blocked, then on the verified one.)
3. **Log in as Lab** → Processing/Lab tab → walk the batch through
   Received → Quality Test (run the **Force Fail** path once to show
   quarantine) → Processed → Package & Activate QR. Point out the journey view
   growing a new hash-linked entry at each step.
4. **Consumer Scan** (no login) → paste the batch code → full provenance + a
   green "all events verified" integrity check.
5. **The proof moment (two-part)**: first attempt a direct `UPDATE` on
   `batch_events` — it's rejected by the append-only DB trigger. Then simulate
   an attacker with elevated DB access by dropping that trigger first and
   tampering again — the consumer verify / Ledger tab now catches it via the
   hash-chain instead. Two independent layers, demonstrated live.
6. **Try to break it via the API directly** (curl/Postman, not the UI), logged
   in as a beekeeper: attempt `POST /api/batches/:id/advance` (lab-only - 403),
   or view another beekeeper's `/api/hives/:id` (403), or omit the session
   cookie entirely (401). This is what separates "the buttons happen to be in
   the right order" from actually-enforced access control.

### Automated tests

`cd backend && npm test` runs 29 tests via Node's built-in test runner (zero
extra dependencies):

- `test/batchStateMachine.test.js` — pure unit tests of every transition rule
  and rejection case in `services/batchStateMachine.js`
- `test/ledger.test.js` — append-only trigger enforcement, and hash-chain
  tamper detection once that protection is deliberately bypassed
- `test/ledger-concurrency.test.js` — spawns several real child *processes*
  (not same-process async code, which wouldn't actually race) that all
  append to the same batch simultaneously, then asserts the resulting `seq`
  values are gap-free and duplicate-free and the chain still verifies. See
  Section 5 for why this needed a genuine multi-process test to be meaningful.
- `test/api.test.js` — full HTTP integration tests against the real Express
  app on an ephemeral port: login for all 3 roles, unauthenticated rejection,
  cross-beekeeper ownership rejection, the unverified-beekeeper harvest block,
  role-boundary rejection (beekeeper attempting a lab-only action), out-of-order
  rejection, quarantine blocking further progress, the admin-approval flow
  unblocking a previously-restricted account, and the full happy path end to
  end, finishing with a whole-ledger integrity check.

Tests run against an isolated SQLite file under `backend/test/` (via the
`HONEYCHAIN_DB_PATH` env var), never the dev/demo database. Since Node's
built-in `fetch` has no cookie jar (unlike a browser), `test/api.test.js`
manually captures the `Set-Cookie` header from each login and replays it as a
`Cookie` header on subsequent requests for that "session."

## 14. Deployment notes

Not deployed anywhere yet, but the codebase doesn't fight a real deployment:

- **Secrets**: `JWT_SECRET` must be a real random value in any non-local
  environment (`.env.example` shows how to generate one) - the app throws
  clearly on boot if it's missing, rather than silently using an insecure default.
- **Cookies cross-origin**: if the frontend is ever served from a different
  origin than the API (rather than Vite's dev proxy hiding this), `NODE_ENV=production`
  switches the session cookie to `sameSite: 'none'; secure: true`, which
  requires HTTPS - `routes/auth.js`'s `cookieOptions()` already branches on this.
- **CORS**: `FRONTEND_ORIGIN` in `.env` must exactly match wherever the
  frontend is actually served from in production (scheme + host + port) - a
  wildcard origin doesn't work with `credentials: true`.
- **Single-process option**: for a simple deployment (e.g. a single Render/
  Railway service), Express could serve the built frontend (`frontend/dist`)
  as static files alongside the API, avoiding CORS/cookie cross-origin concerns
  entirely - not wired up yet, but `server.js` is a normal Express app that
  would accept `express.static(...)` without restructuring.
- **Database**: `node:sqlite` is fine for a single-instance deployment; a
  multi-instance/horizontally-scaled deployment would need Postgres, since
  SQLite's file-based locking doesn't work across separate processes/machines.

## 15. Where this goes next

This document describes the MVP as built. For the full production vision this
MVP is the foundation of — real IoT fleet, real permissioned blockchain,
Madhukranti/KVIC/FSSAI integration, a beekeeper-to-buyer market layer, and a
phased migration path from exactly where this codebase is today — see
[`docs/final-architecture.md`](docs/final-architecture.md).
