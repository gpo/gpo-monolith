# Phase 0 - reviewer notes

Branch: `tax-receipts/phase-0`. Every Phase 0 backlog ticket (0.1 to 0.10;
0.11 is coordination and out of repo). STATUS.md rows 0.1 to 0.10 moved to
`review`.

## TL;DR for the reviewer

```bash
nvm use                     # Node 22.13.1 (.nvmrc)
corepack enable
pnpm install

# 1. everything that does not need a database
pnpm turbo run lint typecheck build
pnpm --filter @gpo/tax-receipts-core test
pnpm --filter @gpo/qomon-client test
pnpm --filter @gpo/warehouse-client test
pnpm --filter @gpo/tax-receipts-web test

# 2. the api's DB tests + migrations need Postgres
pnpm db:test:up             # docker compose: Postgres on localhost:5433
export DATABASE_URL="postgresql://gpo:gpo@localhost:5433/tax_receipts_test?schema=public"
pnpm --filter @gpo/tax-receipts-api test

# or just run the whole pipeline with DATABASE_URL exported:
pnpm turbo run lint typecheck test build
```

CI (`.github/workflows/tax-receipts-ci.yml`) does exactly this against a
Postgres service container on every PR touching `apps/tax-receipts/**` or
`packages/**`.

Last local run on this branch: `lint typecheck test build` green, 20/20
turbo tasks, 100 tests (62 core, 17 qomon-client, 6 warehouse-client, 38
api, 1 web).

## What was built, ticket by ticket

| # | Where | Notes |
|---|---|---|
| 0.1 | root, `apps/tax-receipts/{api,web}`, `packages/*`, CI | Turborepo + pnpm workspace. Fastify "hello" at `GET /` + `GET /health`. Vite/React/Mantine/Tanstack shell with a dashboard and a login form. `pnpm turbo run lint typecheck test` wired; CI green. |
| 0.2 | `api/prisma/schema.prisma` | All 20 data-model §2 entities, exact names and relations. `Artifact` is referenced by `Receipt`, `RtdFiling`, `EntityReport`, `EOForm`, and `WorkItem`. Plus `ReconciliationMatch` (the ReconciliationMark<->Contribution join the doc calls for) and `EntityReportReceipt`. Native PG enums mirror `tax-receipts-core`; `src/domain/enum-parity.test.ts` fails if they drift. |
| 0.3 | `api/prisma/migrations/20260910120100_invariants_1_5` | Invariants 1-5 as raw SQL triggers, enforced in the DB. Tests in `src/invariants/db-invariants.test.ts` prove each rejects a bad write. |
| 0.4 | `api/src/changelog/write.ts` | `withChangeLog(prisma, actor, fn)`: one transaction, tx-local actor context, `ctx.log()` writes the entry, deferred DB check verifies it landed. Every later mutating path uses this. |
| 0.5 | `api/src/auth/*`, `api/src/plugins/auth.ts` | Passport local + bcrypt(js) + Prisma-backed sessions. CASL abilities keyed on role + per-riding grants (`ridingScopeWhere` gives the Prisma `where`). `issue Receipt` = `party_cfo` or `isCfoDesignate`. Kill switch (`IssuanceKillSwitch` singleton) via `assertIssuanceEnabled`, audited through `withChangeLog`. |
| 0.6 | `packages/tax-receipts-core/src/period/calendar.ts` | `resolvePeriod` (minute precision, election periods win over annual, by-elections scoped to riding, ambiguity throws), `contributionYear` / `etIsoDate` / `formatEoDate` (ET over UTC). Year-boundary + spring/fall DST tests. |
| 0.7 | `packages/tax-receipts-core/src/limits/contribution-limit.ts` | `evaluateLimits`: reads `ContributionLimit` rows, attributes each contribution to a bucket, aggregates per group (party = one aggregate; CA/campaign = per riding; candidate-self exempts own campaign). No figure or active-bucket list is hardcoded. |
| 0.8 | `packages/qomon-client` | Typed REST client, Bearer, 5 rps self-throttle, exponential backoff, limit/offset pagination helper, whole-object metadata write, `GuardedContactWriter` (sync `POST /contacts` + field-complete replace only), `ChangeFeedSource` abstraction, in-memory `InMemoryQomon` fake + a shared contract suite. |
| 0.9 | `packages/warehouse-client` | `WarehouseReader` interface, `BigQueryWarehouseReader` (keyset pagination, parameterized SQL, lazy `@google-cloud/bigquery` import), `InMemoryWarehouse` fake. Built to the documented read contract; not wired to a real warehouse. |
| 0.10 | `packages/tax-receipts-core/src/rtd/business-days.ts` | `BusinessDayClock` over `BusinessDayCalendar` rows (annual config, stored in the DB, seeded by `standardOntarioEsaHolidays`). `rtdDueDate`, `businessDaysRemaining`, `isFilingLate`. Tests cover weekends, all nine ESA holidays, and the year boundary. |

## Deviations from spec, and why

1. **Schema has 23 models, not "21".** The 20 named data-model §2 entities,
   plus `ReconciliationMatch` (the "contribution ids matched (join table)"
   the doc explicitly calls for - this is the 21st), plus
   `EntityReportReceipt` (makes `EntityReport }o--o{ Receipt` explicit;
   `EntityReport.includedSet` jsonb still records the point-in-time set per
   the doc). Plus three tables that are **infrastructure, not domain
   entities**, each required by a Phase 0 ticket and labelled as such in the
   schema:
   - `IssuanceKillSwitch` - ticket 0.5 / EFA s.25.1(7). A singleton row so
     the switch state is auditable and has a kill-switch UI home (1.12).
   - `BusinessDayCalendar` - ticket 0.10. The RTD holiday list "as annual
     configuration, not code" needs a table.
   - `Session` - ticket 0.5. Stateful sessions need a store; in-memory is
     not acceptable for a regulated system on k8s.
   If the intent was exactly 21 models, `EntityReportReceipt` and the three
   infra tables are the ones to challenge.

2. **Prisma keeps camelCase column names** (only table names are
   snake_cased via `@@map`). The hand-written invariant SQL therefore uses
   quoted camelCase identifiers. Adding `@map` to ~150 columns was judged
   not worth it for Phase 0; revisit if the team prefers snake_case columns.

3. **`bcryptjs`, not `bcrypt`.** Same algorithm, pure JS, no native build -
   keeps CI simple. Swap to `bcrypt` if a native build is wanted.

4. **`ContributionLimitBucket` is still an enum in code.** O15 says "never
   hardcode a figure or the bucket list". Figures and which buckets are
   active in a year are 100% data (`ContributionLimit` rows). What is code
   is *how a contribution is attributed to one of the five known buckets*
   and how each bucket aggregates (party vs per-riding vs candidate-self).
   A genuinely new bucket kind would need an attribution rule added to
   `attributeBucket`. Flagged here as the one place the "no code" goal is
   not fully met.

5. **`withChangeLog` throws if the block logs nothing.** The DB only
   enforces invariant 5 when a *guarded* table (metadata/receipt/allocation)
   is touched. The helper adds a belt-and-braces check so a `withChangeLog`
   block that forgets to call `ctx.log()` fails loudly rather than silently.

6. **Deferred constraint triggers for invariant 1.** So a Phase 3 reissue
   (cancel old receipt, issue replacement, in one transaction) is judged
   only at commit, never mid-cascade. `require_change_log_context` is a
   BEFORE trigger that returns the row (a NULL return would silently skip
   the write and panic the Prisma engine - learned the hard way).

## What is faked vs real

| Thing | State |
|---|---|
| Qomon REST client | Real HTTP client, shapes verified against the live sandbox 2026-09-10. CI runs the **fake** only (`InMemoryQomon`), no network. |
| Qomon transaction `metadata` field | Does **not exist** in Qomon yet (assumption A1 / R1). The client and fake both implement writing/reading it so the tool is ready; the sandbox contract run skips the metadata round-trip. |
| Qomon sandbox tests | `QOMON_SANDBOX=1 pnpm --filter @gpo/qomon-client test:sandbox`. Key read from env or `../qomon-test/.env` (gitignored, never committed). These create disposable contacts/bundles in the sandbox. |
| BigQuery warehouse | **Not seeded** (blocked on C1/C2). `warehouse-client` runs against `InMemoryWarehouse`; the BigQuery reader is exercised through a stub query client. Table names are the documented default, overridable via config. |
| Qomon change dumps (S3) | Bucket does not exist (O28, raised in open-questions.md). Feed abstracted behind `ChangeFeedSource`; only `QomonPollChangeFeed` exists. |
| Postgres for tests | Local: `pnpm db:test:up` (Docker, port 5433). CI: service container. No testcontainers dependency. |
| Receipt sequence seed | Seeded at 402509 (the legacy global max, data-model §7) in `prisma/seed.ts` and the test baseline. |

## Open questions raised

- **O28** - the Qomon change-dump S3 bucket, its layout, a sample payload,
  and whether S3 replaces or supplements API polling for the sweep.
- **O29** - documented Qomon contract vs live sandbox differences (error
  shape, status kinds, extra fields).

Both added to `../qomon-migration-documents/tax-receipts/design/open-questions.md`.
STATUS.md B7 updated with the sandbox error-taxonomy findings.

## Not done (correctly out of Phase 0 scope)

Invariants 6-8 (behavioural, land with RTD / receipts / ticket 1.6). The
mirror sweep, validation engine, RTD builder, issuance, PDFs, reports - all
Phase 1+. The web app is a shell: no real screens yet.
