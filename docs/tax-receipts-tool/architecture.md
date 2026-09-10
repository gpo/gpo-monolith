---
last-reviewed: 2026-09-10
review-interval-days: 60
---

# Tax Receipts tool: code layout and how to run it

Public, non-confidential companion to the private knowledge base (see
[`README.md`](README.md)). Covers only what the code in this repo is and how
to build it. Design rationale, Elections Ontario rules, and Qomon specifics
live in the private `gpo/qomon-migration-documents` repo.

## Where the code lives

```
apps/tax-receipts/
  api/     Fastify + Zod + Prisma + PostgreSQL   (@gpo/tax-receipts-api)
  web/     Vite + React + Mantine + Tanstack     (@gpo/tax-receipts-web)
packages/
  tax-receipts-core/   domain enums, money, the Qomon metadata schema,
                       the period calendar, the ContributionLimit service,
                       the RTD business-day clock, pure invariant helpers
  qomon-client/        typed Qomon REST client, self-throttled, with an
                       in-memory contract fake (used by CI, no network)
  warehouse-client/    BigQuery read client for bulk lists and history,
                       with a local fake (warehouse not seeded yet)
```

Turborepo + pnpm workspace. `node-linker=hoisted` so the shared toolchain
resolves from every package. Node version is pinned in `.nvmrc`.

## Commands

```bash
pnpm install
pnpm turbo run lint typecheck test build     # everything

# the api's DB tests and migrations need Postgres:
pnpm db:test:up                              # Postgres on :5433 via Docker
export DATABASE_URL="postgresql://gpo:gpo@localhost:5433/tax_receipts_test"
pnpm --filter @gpo/tax-receipts-api migrate:deploy
pnpm --filter @gpo/tax-receipts-api db:seed  # dev/eval seed data

pnpm --filter @gpo/tax-receipts-api dev      # Fastify on :3000
pnpm --filter @gpo/tax-receipts-web dev      # Vite on :5173, proxies /api -> :3000
```

CI is `.github/workflows/tax-receipts-ci.yml`: lint, typecheck, tests
(against a Postgres service container), and builds, on every PR touching
`apps/tax-receipts/**` or `packages/**`.

## Data model and invariants

The Prisma schema (`apps/tax-receipts/api/prisma/schema.prisma`) is the 20
domain entities from the private data model, plus one join table and three
infrastructure tables (kill switch, RTD holiday calendar, sessions). Five
structural invariants are enforced in the database by triggers in the
`invariants_1_5` migration, not just in the service layer:

1. the sum of a contribution's issued allocations never exceeds its eligible
   amount (no double counting);
2. a receipt total is always derived from its allocations (there is no total
   column);
3. receipt numbers come from one monotonic sequence, are immutable, and are
   never freed by cancellation;
4. contributions, receipts, allocations, and change-log rows are never
   hard-deleted;
5. every mutation of metadata, receipts, or allocations happens inside a
   change-logged transaction (actor, reason, before, after), verified at
   commit.

All mutating code paths go through `withChangeLog` (`src/changelog/write.ts`).

## Auth

Passport local + bcrypt, stateful sessions in Postgres. Authorization is
CASL, keyed on role plus per-riding grants. Only the party CFO or an
authorized designate may issue receipts, and a statutory kill switch
(`assertIssuanceEnabled`) gates every issuance path.

## What is faked in Phase 0

- The Qomon transaction `metadata` field does not exist yet, so the
  qomon-client contract suite covers metadata round-tripping against the fake
  only.
- The BigQuery warehouse is not seeded, so `warehouse-client` runs against a
  local fake and the BigQuery reader is exercised through a stub query
  client.
- Qomon change dumps will arrive in an S3 bucket that does not exist yet; the
  "where incremental changes come from" boundary is abstracted behind
  `ChangeFeedSource`.
