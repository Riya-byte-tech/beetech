# 🍯 Honey Chain — MVP (Team Odysseus, SIH 2026 PS 26021)

A full-stack prototype of Honey Chain: a **real login system with three roles**
(Beekeeper, Lab/Processing, Cluster Admin) sits in front of a vertical slice of the
honey supply chain — hive → IoT/AI insight → harvest → **hash-chained, tamper-evident
batch ledger** → processing → quality test → QR packaging → public consumer
verification. New beekeeper registrations require Cluster Admin approval before they
can enter anything into the traceability chain, mirroring the real Madhukranti/KVIC
verification workflow this project's research is built on.

This is the scope frozen in `docs/mvp.txt` in the project research docs, since extended
with real authentication/RBAC (see `mvp-architecture.md` §4 for the full design
rationale) — deliberately a thin, complete slice rather than a wide, half-built
ecosystem.

**Team:** see [`TEAM.md`](TEAM.md). **Research base:** see [`docs/`](docs/) —
these four documents (problem-statement analysis, prior-art survey, workflow/
data-model research, and the MVP scope decision) are what `mvp.txt` and
`mvp-architecture.md` are built on and reference throughout. For where this
project goes beyond the MVP, see [`docs/final-architecture.md`](docs/final-architecture.md).

## Roles

| Role | Can do | Cannot do |
|---|---|---|
| **Beekeeper** | Register hives, view own sensor/AI data, record harvests *(once verified)* | See other beekeepers' hives, touch the processing pipeline |
| **Lab / Processing** | Advance batches through the pipeline, run quality tests, activate QR codes — across *any* beekeeper's batches | See hive/sensor data, approve beekeepers |
| **Cluster Admin** | View cross-hive alerts, the global ledger, approve pending beekeepers | Register hives, run pipeline actions |
| **Consumer** | Scan a QR / enter a batch code — no account needed | Everything else (by design) |

## Architecture

```
frontend (React + Vite)  --/api-->  backend (Node/Express)  -->  SQLite (node:sqlite, built-in)
        |                                   |
        |                                   +--> middleware/auth.js   (session cookie -> req.user, role checks)
   AuthContext                              +--> services/auth.js     (scrypt password hashing, HMAC session tokens)
   (session cookie,                         +--> services/ledger.js   (hash-chained event ledger)
    httpOnly - JS                           +--> services/batchStateMachine.js (server-side pipeline order enforcement)
    can't read it)                          +--> services/ai.js       (rule-based health/yield scoring)
                                             +--> services/simulator.js (mock IoT sensor data)
```

### Why a hash-chain instead of a real blockchain for the MVP?

Per the team's own research (`docs/related-works-and-sources.txt`, `docs/deep-search_honeyChain.txt`):
blockchain's value here is **tamper-evidence + auditable event history**, not
decentralization for its own sake. `services/ledger.js` implements a genuine
append-only, hash-chained ledger — every event's hash is `SHA256(prev_hash + event
data)`, and `batch_events` has DB-level triggers that reject direct `UPDATE`/`DELETE`
outright. Even if that trigger were bypassed, `GET /api/ledger` (admin) and the
consumer verify page independently recompute the whole chain and name the exact
broken event. The event schema is designed so this module can be swapped for a real
smart contract (e.g. Polygon + Solidity) later without changing any caller.

### Why a custom auth implementation instead of Passport/bcrypt/jsonwebtoken?

Consistent with this project's running theme (see: `node:sqlite` instead of
`better-sqlite3` after the Windows node-gyp saga): `services/auth.js` uses only
Node's built-in `crypto` module — `scrypt` for password hashing, HMAC-SHA256 for a
JWT-shaped session token. No native dependencies, nothing to fail to compile on a
teammate's machine, and the whole implementation is ~100 lines you can actually
read end to end rather than trust as a black box. A real production deployment
serving the public internet would reach for a vetted, audited library instead —
this tradeoff is right for a self-hosted demo, not for a bank.

### Why rule-based AI instead of a trained model?

Also per team research: the PS explicitly warns against over-claiming disease
diagnosis. `services/ai.js` produces a transparent, explainable **health score
(0–100) and status flag** (Healthy / Attention / Critical), plus a **yield
prediction** with an explicit confidence percentage. Both are clearly labeled as
predictions/heuristics, never as diagnoses.

## Project structure

```
honey-chain-mvp/
├── backend/
│   ├── .env.example          # copy to .env - see "Running it locally" below
│   ├── db/
│   │   ├── schema.sql          # entities incl. `users` (login accounts) + append-only triggers + indexes
│   │   ├── db.js                # SQLite connection + schema bootstrap
│   │   └── seed.js              # demo accounts for all 3 roles (see credentials below)
│   ├── middleware/auth.js     # requireAuth, requireRole(...), requireVerifiedBeekeeper
│   ├── services/
│   │   ├── auth.js              # password hashing + session tokens (crypto only, no deps)
│   │   ├── ledger.js            # hash-chained event ledger
│   │   ├── batchStateMachine.js # server-side pipeline order enforcement
│   │   ├── ai.js                # health score + yield prediction
│   │   └── simulator.js         # mock IoT sensor readings
│   ├── routes/                # auth, admin, hives, harvests, batches, quality, products, alerts, ledger, certificate
│   ├── test/                  # 28 automated tests (node --test)
│   └── server.js
└── frontend/
    └── src/
        ├── context/AuthContext.jsx    # session restore, login/register/logout
        ├── components/ProtectedRoute.jsx
        ├── pages/
        │   ├── LoginPage.jsx / RegisterPage.jsx
        │   ├── BeekeeperDashboard.jsx / HiveDetail.jsx     (role: beekeeper)
        │   ├── AdminBatchPipeline.jsx                       (role: lab)
        │   ├── ClusterAlerts.jsx / LedgerExplorer.jsx / AdminApprovals.jsx  (role: admin)
        │   └── ConsumerScan.jsx                             (public, no login)
        └── api.js
```

## Running it locally

Requires **Node.js 22.5+** (uses Node's built-in `node:sqlite` module — no native
compilation, no Visual Studio Build Tools, no node-gyp headaches on Windows). Check
your version with `node -v`; if it's older, install the latest LTS from
[nodejs.org](https://nodejs.org).

```bash
# 1. Backend
cd backend
cp .env.example .env
# Open .env and replace JWT_SECRET with a real random value, e.g. output of:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
npm install
npm run seed      # creates demo accounts for all 3 roles (safe to run once; delete db/honeychain.db to reseed)
npm start         # runs on http://localhost:4000

# 2. Frontend (separate terminal)
cd frontend
npm install
npm run dev       # runs on http://localhost:5173, proxies /api to :4000
```

> **Windows PowerShell users:** run each line separately (PowerShell doesn't chain
> commands with `&&` the way bash does).

Open http://localhost:5173 — you'll land on the login page.

### Demo login credentials (created by `npm run seed`)

| Role | Email | Password |
|---|---|---|
| Beekeeper (verified) | `ramesh@honeychain.demo` | `beekeeper123` |
| Beekeeper (**unverified** — for demoing the approval flow) | `sunita@honeychain.demo` | `beekeeper123` |
| Lab / Processing | `lab@honeychain.demo` | `lab123456` |
| Cluster Admin | `admin@honeychain.demo` | `admin12345` |

Lab and Admin accounts are provisioned only via `db/seed.js` — there's no in-app
"create staff account" UI (a deliberate scope call; see `mvp-architecture.md` §4).
Beekeepers self-register via the Register page and start unverified.

You'll see an `ExperimentalWarning: SQLite is an experimental feature` line when the
backend starts — that's expected and harmless.

### Troubleshooting: "Invalid email or password" on a demo account

The demo accounts only exist if `npm run seed` has actually run against your
current database. If you started the server and registered your own account
*before* running `npm run seed` (or skipped seeding entirely), the demo
accounts (including lab/admin, which have no other way to be created) won't
exist yet — your own account will work, but `ramesh@honeychain.demo` etc. will
correctly fail to log in, because they're not there.

Fix: just run `npm run seed` again (or for the first time). It's safe to run
at any point, in any order, against any existing database — it only fills in
whichever of the demo accounts/hives are missing and never duplicates or
touches anything else, including your own account. You'll see a summary of
what it created vs. what already existed, and the demo credentials are always
printed at the end.

### Running the backend tests

```bash
cd backend
npm test
```

Runs 29 tests (`node --test`, no extra dependencies): the batch state machine's
transition rules, append-only ledger + tamper-detection, a genuine multi-process
concurrency test (spawns real OS processes racing to append to the same batch,
proving no duplicate/missing sequence numbers under real concurrent writers —
not just same-process code that wouldn't actually race), and full HTTP
integration tests against the real Express app — including login, role
boundaries, ownership boundaries (a beekeeper can't see another's hives), and
the verification-gate (an unverified beekeeper is blocked from harvesting
until admin-approved). Tests use an isolated SQLite file under `backend/test/`,
never the dev/demo database.

## Demo script (the "hero workflow")

1. **Register a new beekeeper** at `/register` → note the account is created but
   shows "pending verification" — they can register hives and watch sensor data,
   but the **Record Harvest** button is disabled.
2. **Log in as Admin** (`admin@honeychain.demo`) → **Approvals** tab → approve the
   new beekeeper (or the pre-seeded `sunita@honeychain.demo`, already pending).
3. **Log in as Beekeeper** (`ramesh@honeychain.demo`) → open hive `H-001` (Healthy)
   or `H-006` (Critical) → show the AI health score, yield prediction, and sensor
   readings. Try "Simulate: Critical" live to show the score react in real time.
4. Click **Record Harvest** → creates a batch, writes `HARVEST_RECORDED` and
   `BATCH_CREATED` events to the ledger.
5. **Log in as Lab** (`lab@honeychain.demo`) → Processing/Lab tab → walk the new
   batch through Received → Quality Test (Pass, or **Force Fail** to show
   quarantine) → Processed → Package & Activate QR. Download the **PDF
   certificate**. Try switching back to the Beekeeper account and attempting a
   pipeline action directly via the URL — it's rejected server-side, not just
   hidden in the UI.
6. **Consumer Scan** (no login needed) → paste the batch code → full verified
   journey + live blockchain integrity check + downloadable certificate.
7. **Log in as Admin** → **Ledger** tab (whole-system event timeline) and
   **Cluster Alerts** tab (flagged hives across every beekeeper).
8. **The two-layer tamper-evidence proof** (strongest demo moment):

   **Part A — the database itself refuses to be tampered with.**
   ```bash
   cd backend
   node -e "
   const db = require('./db/db');
   db.prepare(\"UPDATE batch_events SET payload = '{}' WHERE seq = 3\").run();
   "
   ```
   Throws `batch_events is append-only: UPDATE is not permitted` — the edit never happens.

   **Part B — even if that protection were bypassed, the hash-chain still catches it.**
   ```bash
   cd backend
   node -e "
   const db = require('./db/db');
   db.exec('DROP TRIGGER IF EXISTS trg_batch_events_no_update');
   db.prepare(\"UPDATE batch_events SET payload = '{\\\"tampered\\\":true}' WHERE seq = 3\").run();
   "
   ```
   Re-run the consumer verify or the Ledger tab — it names the exact broken event.

## Feature list (as of this version)

| Feature | Where |
|---|---|
| **Real login/logout, 3 roles, httpOnly session cookies** | `/login`, `/register` |
| **Beekeeper self-registration with admin-approval gate** | Register page → Admin Approvals tab |
| **Server-side role + ownership enforcement on every route** (not just hidden UI) | All routes |
| Hive registration + simulated IoT sensors | Beekeeper tab |
| AI health score + yield prediction | Beekeeper tab → hive detail |
| Harvest recording → batch creation (blocked until verified) | Beekeeper tab → hive detail |
| Batch pipeline with server-side state-order enforcement | Processing / Lab tab (role: lab) |
| Hash-chained, append-only (DB triggers) ledger with live tamper-evidence check | Ledger, Consumer Scan tabs |
| QR generation + consumer verification | Processing / Lab → Consumer Scan |
| Downloadable PDF certificate of provenance | Processing / Lab and Consumer Scan |
| Global ledger explorer (admin only) | Ledger tab |
| Cross-hive cluster alerts across all beekeepers (admin only) | Cluster Alerts tab |
| Automated tests (28, `npm test`) incl. auth/RBAC | `backend/test/` |

## Security & scope tradeoffs (decisions, not oversights)

| Not included | Why | What we'd add for production |
|---|---|---|
| Vetted auth library (Passport/jsonwebtoken/bcrypt) | Zero native deps, ~100 lines, fully auditable by the team | A maintained, security-audited library for a public-internet deployment |
| Rate limiting on login | Local/demo deployment only | Standard brute-force protection (e.g. `express-rate-limit`) |
| Email verification / password reset | Not needed for a hackathon demo | Full account-recovery flow |
| In-app staff account management | Only ever 1-2 lab/admin accounts needed; seed script is enough | An admin UI for provisioning staff accounts |
| SQLite instead of Postgres | Zero-setup, zero native compilation | Postgres for real concurrent multi-cluster write load |
| No batch split/merge genealogy | Deliberately trimmed from `docs/mvp.txt`'s scope | Schema and event vocabulary already anticipate it (see `mvp-architecture.md`) |

What **is** now enforced for real: login is required for every non-public route,
role checks happen server-side (verified by trying the wrong role's action directly
against the API, not just clicking around the UI), a beekeeper cannot see or act on
another beekeeper's data, an unverified beekeeper cannot enter anything into the
traceability chain, passwords are hashed (never stored plain), and the session
cookie is httpOnly (client-side JS cannot read or exfiltrate it via XSS).

## What's deliberately out of scope for this MVP

See `docs/mvp.txt` for the full reasoning. Not built: real blockchain network, FPO/market
layer, real lab integration, Madhukranti/KVIC API integration, batch split/merge
genealogy, trained ML disease models, real IoT hardware (a simulation mode stands
in). The data model and event schema are designed so these can be added later
without a rewrite.

## Team & License

Built by **Team Odysseus** for SIH 2026, PS 26021. See [`TEAM.md`](TEAM.md) for
members and mentors. Licensed under [MIT](LICENSE).

