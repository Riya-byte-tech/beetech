# Honey Chain — Final-Form Architecture (Production Vision)

**Team Odysseus · SIH 2026 · PS 26021**

This document sketches what Honey Chain becomes beyond the MVP — the full,
production-scale system the research in `docs/` was aiming at all along. The
MVP (`mvp-architecture.md`) is not a prototype we'd throw away and rebuild; it's
the proven core that this document extends outward from. Every section below
says explicitly what's inherited unchanged versus what's new.

> **One sentence:** Honey Chain becomes a permissioned-blockchain-backed trust
> and intelligence layer that sits *over* India's existing beekeeping
> infrastructure (Madhukranti, KVIC Honey MIS, FSSAI FoSCoS) rather than
> replacing it — connecting a real IoT hive fleet, trained AI models, a real
> multi-org blockchain network, and a beekeeper-to-buyer marketplace, all
> built on the same event-sourced data model and role structure the MVP
> already validated.

---

## 1. What carries over from the MVP unchanged

This matters as much as what's new — it's why the MVP wasn't throwaway work:

- **The event model.** `HARVEST_RECORDED → BATCH_CREATED → BATCH_RECEIVED →
  BATCH_TESTED → BATCH_PROCESSED → QR_ACTIVATED` is a subset of the full
  vocabulary in `docs/deep-search_honeyChain.txt` §29. The final form adds
  events (`BATCH_SPLIT`, `BATCH_MERGED`, `HIVE_MOVED`, `PRODUCT_SOLD`,
  `PRODUCT_RECALLED`, ...) but doesn't change the *shape* of an event.
- **The role model.** Beekeeper / Lab / Admin / Consumer is the seed of the
  full actor model in §14 below — final form adds actors, it doesn't restructure
  the ones that exist.
- **The state machine pattern.** `services/batchStateMachine.js`'s
  centralized, unit-tested transition rules are exactly how the final form's
  batch lifecycle (now including split/merge and recall) gets encoded into a
  smart contract — the logic moves, the *pattern* of "one place defines valid
  transitions, everything else calls it" doesn't.
- **On-chain/off-chain separation.** Full values in events, hashes for large
  documents, telemetry off-chain in a time-series store — this discipline is
  what makes the final form's real blockchain affordable at scale instead of
  becoming an expensive, slow database.
- **AI framed as risk/prediction, never diagnosis.** This is a product
  principle from `docs/related-works-and-sources.txt` §12-13, not an MVP
  shortcut — it holds at any model quality.

---

## 2. System architecture

```text
                                   CLIENT LAYER
   ┌───────────┬───────────┬────────────┬────────────┬─────────────────┐
   │ Beekeeper │  Lab /    │  Cluster   │  Buyer /    │   Consumer      │
   │  Mobile   │Processing │   Admin    │  FPO Web    │  QR Web (PWA)   │
   │  App      │  Portal   │  Dashboard │  Portal     │  (public)       │
   │(offline-  │           │            │             │                 │
   │ first)    │           │            │             │                 │
   └─────┬─────┴─────┬─────┴──────┬─────┴──────┬──────┴────────┬────────┘
         │           │            │            │               │
         └───────────┴─────┬──────┴─────┬──────┴───────────────┘
                            │ HTTPS / API Gateway (authn, rate-limit, routing)
                            ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │                       SERVICE LAYER (microservices)                  │
   │                                                                       │
   │  Identity &    Hive/IoT     Harvest/Batch   Ledger      AI/ML         │
   │  Access Svc    Svc          Svc             Svc         Svc            │
   │                                                                         │
   │  Notification  Market/FPO   Integration     Certificate                 │
   │  Svc           Svc          Svc (Madhukranti/KVIC/FSSAI adapters)        │
   └───────┬───────────┬─────────────┬──────────────┬───────────────┬───────┘
           │           │             │              │               │
           ▼           ▼             ▼              ▼               ▼
   ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌──────────────┐ ┌───────────┐
   │ Postgres  │ │Time-series│ │  Object   │ │  Permissioned│ │  Model    │
   │(relational│ │DB (sensor │ │  Storage  │ │  Blockchain  │ │  Serving  │
   │ core)     │ │telemetry) │ │(certs,    │ │  (Hyperledger│ │  (health/ │
   │           │ │           │ │ images)   │ │   Fabric)    │ │  yield/   │
   │           │ │           │ │           │ │              │ │  disease) │
   └───────────┘ └───────────┘ └───────────┘ └──────┬───────┘ └───────────┘
                                                     │
                                              ┌──────┴───────┐
                                              │ Oracle layer  │
                                              │ (IoT / Lab /  │
                                              │ Institutional)│
                                              └───────────────┘
           ▲
           │  LoRaWAN / Wi-Fi gateway per apiary cluster
   ┌───────┴────────────────────────────────────────────────┐
   │  IoT FLEET: ESP32 + DHT22 + load cell + mic, per hive     │
   │  10-20 hives → 1 gateway → cloud when connectivity allows │
   └────────────────────────────────────────────────────────┘
```

This is a genuine evolution of the MVP diagram in `mvp-architecture.md` §2, not a
different system: the "Service Layer" boxes above are what
`backend/routes/*.js` grows into once there's enough load/team size to
justify splitting a monolith into services; Postgres replaces `node:sqlite`
for the same relational data; the blockchain replaces `services/ledger.js`'s
hash-chain using the *same* event schema.

---

## 3. Client layer

| Client | Who | Key difference from MVP |
|---|---|---|
| Beekeeper mobile app | Beekeepers, esp. rural/low-connectivity | **Offline-first**: queues harvest/hive events locally, syncs when connectivity returns (per `docs/related-works-and-sources.txt` §23's rural-deployment findings). MVP's web dashboard becomes the "connected" fallback. |
| Lab/Processing portal | Lab staff | Same role/actions as MVP's Processing/Lab tab, now potentially one per registered processing facility, with facility identity coming from the Integration Service (§7) rather than a seeded account. |
| Cluster Admin dashboard | KVIC/NBB cluster administrators | MVP's Cluster Alerts + Ledger + Approvals, extended with disease-outbreak heatmaps (`docs/deep-search_honeyChain.txt` §37) and FPO oversight. |
| Buyer/FPO web portal | Traders, processors, exporters, FPOs | **New.** Discovers verified batches/beekeepers, initiates orders — the "market linkage" pillar from `docs/understanding_our_chosen_problem_statement.md` §8, deliberately out of MVP scope. |
| Consumer QR web app | Public | Same as MVP's Consumer Scan, now a installable PWA so it works from a phone camera scan with no app install. |

---

## 4. IoT layer (real fleet, not simulated)

```text
Hive
 └── Sensor node (ESP32 + DHT22 + load cell + optional mic)
        │ BLE/LoRa (low power)
        ▼
   Apiary gateway (Wi-Fi/4G uplink, 1 per 10-20 hives)
        │ MQTT
        ▼
   Ingestion service → validates + signs readings (IoT oracle) → time-series DB
        │
        ▼
   AI feature pipeline (rolling windows, anomaly features) → Model Serving
```

`services/simulator.js` doesn't disappear — it becomes the **development and
demo fallback** ("Simulation Mode", explicitly called for in `docs/mvp.txt`
§9 for exactly the reason stated there: hardware fails five minutes before a
demo). Production hives run real sensors; a sandbox/demo environment still
runs the simulator. The ingestion service is what `POST /api/hives/:id/readings`
becomes (already listed as an extension point in `mvp-architecture.md` §11) — same
row shape, real signing/auth added at the gateway.

---

## 5. AI/ML layer (trained models, not heuristics)

| MVP (`services/ai.js`) | Final form |
|---|---|
| Rule-based health score from 3 thresholds | Multimodal colony-health classifier: environment + acoustic + (optionally) vision, per `docs/related-works-and-sources.txt` §13's 2026 Varroa-detection research |
| Linear yield heuristic | Trained regression/ensemble model on hive weight trend + climate + season, per §14's ML-yield-prediction literature |
| No disease detection (deliberately, per `docs/deep-search_honeyChain.txt` §13) | **Disease *risk* scoring only, still never diagnosis** — outputs feed a "recommend inspection" workflow, with an expert/vet confirmation step before anything is asserted as fact on-chain |

The output contract stays identical on purpose: `{ score, status, reason,
flag }` for health, `{ predicted_kg, confidence, explanation }` for yield.
Swapping the model implementation behind that contract (already how
`services/ai.js` is structured) is the whole migration — no caller changes.

---

## 6. The real blockchain layer

**Why Hyperledger Fabric specifically:** the actor model in
`docs/deep-search_honeyChain.txt` §24-25 is inherently multi-organization —
KVIC, NBB, individual beekeepers, independent labs, FPOs are separate trust
domains, not one company's users. Fabric's channel/organization model maps
onto that directly; a public chain (Polygon/Ethereum) doesn't have a
first-class concept of "these five organizations, each running their own
node, jointly maintain this ledger."

```text
Organizations (each runs peer nodes):
  KVIC  │  NBB  │  Cluster/State Admin  │  Certified Labs  │  (Beekeepers via a shared org)

Chaincode (smart contract) encodes:
  - The exact state machine in services/batchStateMachine.js today
  - assertAdvance / assertQualityTest / assertActivateQr become chaincode functions
  - Append-only is structural, not enforced by a trigger - a blockchain
    literally cannot UPDATE a committed block
```

**The oracle problem** (`docs/related-works-and-sources.txt` §21) is the
hard part, not the chain itself:

| Oracle | Trust source | MVP equivalent |
|---|---|---|
| IoT oracle | Gateway-signed sensor batches | `simulator.js` writes directly - no signing needed yet |
| Lab oracle | Certified lab's signed test result | `quality.js`'s simulated record, explicitly labeled as such |
| Institutional oracle | KVIC/NBB officer action (e.g. beekeeper verification) | `routes/admin.js`'s `/verify` endpoint - already the right *shape*, just not yet backed by a real credentialed officer identity |

**On-chain vs off-chain** is unchanged from `mvp-architecture.md` §5's table -
full event data on-chain, telemetry/large documents off-chain with hash
commitments. This discipline is *more* important at real-blockchain scale,
not less: Fabric block size and throughput are finite resources in a way a
single SQLite file's disk space isn't.

---

## 7. Government integration layer

The single most important architectural decision from the entire research
phase (`docs/related-works-and-sources.txt` §2, §26): **Honey Chain
integrates with Madhukranti/KVIC/FSSAI, it does not replace them.**

```text
Integration Service
   ├── Madhukranti adapter    → beekeeper identity, colony verification records
   ├── KVIC Honey MIS adapter → production/bottling/inventory sync
   └── FSSAI FoSCoS adapter   → lab/FBO licensing status, official test methods
```

Concretely, this is why `beekeepers.id` and `hives.id` in the MVP schema are
plain application-generated strings (`BK-XXXXXX`) rather than, say,
auto-increment integers or UUIDs with embedded meaning: they're designed to
be **replaced by a Madhukranti-issued ID** once that integration exists,
without a schema migration — the column stays a string, only where the string
comes from changes. The Integration Service is the only thing that would
need to change; every other service keeps treating `beekeeper_id` as an
opaque identifier.

---

## 8. Market / FPO layer (new)

Deliberately out of MVP scope (`docs/mvp.txt` §2 explicitly lists "FPO
marketplace" as ❌), this is where the "weak market linkages" problem from
`docs/understanding_our_chosen_problem_statement.md` §8 gets addressed:

```text
Verified beekeeper → Verified batch (PACKAGED status, passed quality test)
        ↓
MarketplaceListing (quantity available, floral source, district)
        ↓
Buyer/FPO discovers via Buyer Portal
        ↓
Order → (off-chain payment integration) → Ownership/custody transfer event
        ↓
BATCH_SHIPPED / BATCH_RECEIVED events (already in the event vocabulary,
unused until this layer exists)
```

The batch's ledger history doesn't restart at sale — `PRODUCT_SOLD` becomes
another event on the same chain, so a consumer scanning a QR after resale
still sees the complete, unbroken provenance.

---

## 9. Data model additions

Everything in `mvp-architecture.md` §3 stays. Final form adds:

```text
Batch genealogy (docs/deep-search_honeyChain.txt §15, listed as an extension
point in mvp-architecture.md §11):
   BATCH_SPLIT: one batch → many child batches (different jars from one harvest)
   BATCH_MERGED: many batches → one (aggregating multiple small harvests)

Hive migration (§10 of the same doc):
   HIVE_MOVED events with authorized_by + reason, not just an overwritten
   current_location field - "where has this hive been," not just "where is it"

Market entities:
   FPO, Buyer, Order, MarketplaceListing, Transaction

Government/compliance entities:
   Registration, Verification, SchemeBeneficiary, Training, Certification
```

The `batch_events` table's *shape* doesn't change for any of this - these are
new `event_type` values and new tables for the entities they reference, not a
redesign of the ledger itself.

---

## 10. Full actor × permission model

Extending `mvp-architecture.md` §4's route matrix with the actors identified in
`docs/deep-search_honeyChain.txt` §24-25:

| Actor | Creates | Verifies | Views |
|---|---|---|---|
| Beekeeper | Hive, harvest | — | Own data |
| FPO | Aggregation batches | — | Member beekeepers' verified batches |
| Processor/Lab | Processing event, test result | Test result | Batches in their custody |
| Cluster/State Admin | — | Beekeeper accounts, colony counts | Cluster-wide |
| KVIC | Beneficiary records | Training completion | Program-wide |
| NBB | Registration | Beekeeper/colony identity | Cross-cluster |
| Buyer | Orders | — | Public + purchased batch detail |
| Consumer | — | — | Public provenance only |

This is a refinement of the MVP's 3-role model (`mvp-architecture.md` §4), not a
replacement — Beekeeper/Lab/Admin map onto Beekeeper/Processor/Cluster Admin
above with the same ownership-scoping principle (`assertOwnsHive`-style
checks) extended to more actor types.

---

## 11. Security, identity & compliance

- **Identity verification**: beekeeper registration's current admin-approval
  flow (`requireVerifiedBeekeeper`) becomes the *first* verification tier;
  final form adds Aadhaar-linked KYC or Madhukranti-identity cross-checking
  as an optional stronger tier for higher-value transactions (large batch
  sales, FPO membership).
- **Auth**: `services/auth.js`'s scrypt/HMAC approach is fine for the MVP's
  scale; a real multi-service deployment would move to a dedicated Identity
  & Access service issuing short-lived tokens validated by every other
  service (still likely HMAC/JWT-based - the *pattern* survives, the
  single-file implementation becomes a shared service).
- **Audit logging**: every admin action (verify beekeeper, override, etc.)
  gets its own immutable log, same append-only principle as `batch_events`.
- **Compliance**: FSSAI licensing status (via the Integration Service, §7)
  gates whether a lab's test results are even eligible to be recorded,
  closing a gap the MVP doesn't address (any seeded "lab" account can
  currently record a test - final form ties that to a real, checked FBO
  license).

---

## 12. Observability & operations

Not meaningfully present in the MVP (a hackathon demo doesn't need it); real
deployment does:

```text
Structured logging  → centralized log aggregation (every service)
Metrics             → request rates, latencies, queue depth, IoT ingestion lag
Tracing             → cross-service request tracing (a harvest→batch→ledger
                       write now spans multiple services, not one process)
Alerting            → on-call paging for ledger-write failures, blockchain
                       node health, IoT gateway dropout
```

---

## 13. Deployment architecture

```text
                    ┌─────────────────────┐
                    │   CDN / Static hosting│  → Consumer PWA, marketing site
                    └─────────────────────┘
                    ┌─────────────────────┐
                    │   API Gateway (LB)    │  → TLS termination, rate limiting
                    └──────────┬──────────┘
           ┌───────────────────┼───────────────────┐
           ▼                   ▼                   ▼
   ┌───────────────┐  ┌───────────────┐   ┌───────────────┐
   │ App services   │  │ AI/ML serving  │   │ Blockchain     │
   │ (containerized,│  │ (GPU/CPU pool) │   │ peer nodes     │
   │  horizontally   │  │                │   │ (per org)      │
   │  scaled)        │  │                │   │                │
   └───────┬───────┘  └───────┬───────┘   └───────┬───────┘
           ▼                   ▼                   ▼
   ┌───────────────┐  ┌───────────────┐   ┌───────────────┐
   │ Postgres        │  │ Time-series DB│   │ Object storage │
   │ (managed, HA)   │  │ (managed)     │   │ (S3-compatible)│
   └───────────────┘  └───────────────┘   └───────────────┘
```

This is the point where `node:sqlite`'s single-file, single-process model
genuinely needs to be swapped for Postgres — flagged as a tradeoff, not an
oversight, in `README.md`'s "Security & scope tradeoffs" table since the
MVP's very first version. `db.prepare(...)` calls throughout the codebase are
the migration surface: the query interface stays close to standard SQL, the
connection/pooling layer changes.

---

## 14. Migration roadmap: MVP → final form

Phased so each stage ships something demoable, matching the MVP's own
"thin, complete slice" philosophy rather than a big-bang rewrite:

```text
Phase 0 (done)   MVP: 3-role auth, hash-chain ledger, simulated IoT/AI,
                 single beekeeper cluster, manual seed data

Phase 1          Real IoT: swap simulator.js for real ESP32 fleet via the
                 ingestion-service extension point already designed in
                 mvp-architecture.md §11. AI models trained on the resulting
                 real telemetry (still same output contract).

Phase 2          Madhukranti/KVIC integration: Integration Service adapters,
                 beekeeper identity cross-checked against Madhukranti
                 records instead of (or alongside) admin approval.

Phase 3          Real blockchain: Hyperledger Fabric network stood up
                 alongside the existing hash-chain (parallel-write, verify
                 both agree) before cutting over - de-risks the migration
                 by proving equivalence before removing the fallback.

Phase 4          Market/FPO layer + multi-cluster deployment: buyer portal,
                 order flow, and horizontal scaling across multiple
                 KVIC/NBB clusters rather than one apiary.
```

Each phase is additive to the previous one's data model and event
vocabulary — nothing in Phase 0 gets deleted to make room for Phase 1-4, only
extended, which is the same principle the MVP itself was built on from the
start (`docs/mvp.txt` §13: "the architecture merely shouldn't prevent them later").
