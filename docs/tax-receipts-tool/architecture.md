---
last-reviewed: 2026-10-06
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

# the api's tests need a Postgres on :5433 (docker-compose.test.yml).
# TRUNCATEd before every test file and tmpfs-backed: never persisted, never
# for dev data.
pnpm db:test:up
export DATABASE_URL="postgresql://gpo:gpo@localhost:5433/tax_receipts_test"
pnpm --filter @gpo/tax-receipts-api test

# day-to-day dev/manual-testing data is a SEPARATE Postgres on :5434
# (docker-compose.dev.yml), with a persistent named volume. This is what
# apps/tax-receipts/api/.env's DATABASE_URL points at.
pnpm db:dev:up
# migrate/seed go through the Prisma CLI, which (prisma.config.ts is
# present) does NOT read .env itself — export DATABASE_URL for these two:
export DATABASE_URL="postgresql://gpo:gpo@localhost:5434/tax_receipts_dev"
pnpm --filter @gpo/tax-receipts-api migrate:deploy
pnpm --filter @gpo/tax-receipts-api db:seed  # dev/eval seed data (sysadmin@gpo.test, etc.)

# `dev`/`db:seed` load apps/tax-receipts/api/.env themselves (tsx --env-file)
# — but env vars already exported in your shell win over .env, so if you
# exported DATABASE_URL above (or ever, in this shell), `unset DATABASE_URL`
# before running `dev` or it'll keep pointing at whatever you last exported.
pnpm --filter @gpo/tax-receipts-api dev      # Fastify on :3000
pnpm --filter @gpo/tax-receipts-web dev      # Vite on :5173, proxies /api -> :3000
```

CI is `.github/workflows/tax-receipts-ci.yml`: lint, typecheck, tests
(against a Postgres service container), and builds, on every PR touching
`apps/tax-receipts/**` or `packages/**`.

## Deploying

`apps/tax-receipts/Dockerfile` builds three images from the repo root: `api`
(the Fastify server), `api-tools` (runs `prisma migrate deploy`, and the
evaluation seed on request), and `web` (nginx serving the SPA and proxying
`/api/*` to the api, the same contract as the Vite dev proxy).
`apps/tax-receipts/docker-compose.staging.yml` runs the whole stack, and
`apps/tax-receipts/DEPLOY.md` is the hand-off for operations: topology,
environment variables, rollout order, and the single-instance constraint
(PDFs on local disk, in-process email dispatcher). The api's `build` copies
the generated Prisma client into `dist/`, so `node dist/server.js` runs on
its own.

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
4. contributions, contacts, receipts, allocations, and change-log rows are
   never hard-deleted;
5. every mutation of contributions, contacts, receipts, or allocations
   happens inside a change-logged transaction (actor, reason, before,
   after), verified at commit. Later migrations extended this guard to
   `contribution` and `contact`.

All mutating code paths go through `withChangeLog` (`src/changelog/write.ts`).
Period and contribution-limit edits under Admin also take a reason and are
change-logged, though those tables are not guarded by a trigger. Tests that
need a contact or contribution row directly use `fixtureContact` and
`fixtureWrite` in `api/src/test/db.ts`.

## Contributors

Contributors (`contact` rows) are added and edited under **Contributors**
(`/contributors`), from the donor picker on payment entry, and from a
contribution's detail page. All writes go through `api/src/contacts/write.ts`.
Who owns a contact depends on whether the API has a Qomon client
(`QOMON_API_KEY` set):

- **Without Qomon**, contacts are owned by the tool: a new one has no
  `qomonContactId`, and edits update the row.
- **With Qomon**, a new contributor is created in Qomon first and then
  mirrored with its Qomon id. Editing a Qomon-linked contact writes only the
  changed fields to Qomon (read, merge, full replace, via
  `QomonApi.updateContact`) and then mirrors what Qomon holds. If Qomon
  refuses, nothing is written locally.
- A Qomon-linked contact cannot be edited while Qomon is not configured
  (409). A contact with no Qomon link stays tool-owned either way.

The import sweep and the "refresh donor from Qomon" action write contacts
through the same module (`mirrorQomonContact`), so every contact change has a
`Contact` change-log entry: the sweep's with no actor, the others with the
user's. A contact edit re-runs validation on that contributor's active
contributions. `GET /contacts/settings` tells the web form which mode it is
in. Adding and editing contributors needs the `contact.manage` permission.

## Auth

Passport local + bcrypt, stateful sessions in Postgres. Authorization is
CASL, keyed on the user's role permissions plus per-riding grants. Only the
party CFO or an authorized designate may issue receipts, and a statutory
kill switch (`assertIssuanceEnabled`) gates every issuance path.

Roles are data, not code. Each user holds one row in `role`, and a role
holds permission keys (`role_permission`). Administrators create and edit
roles under Admin, Roles, and assign them under Admin, Users. The
permissions themselves are a fixed catalogue in `api/src/auth/permissions.ts`
that maps each key to the CASL rules the routes check, so a new system
function means a new catalogue entry. The ten roles the tool ships with
(`BUILT_IN_ROLES`) are seeded by the `role_table` migration and by
`ensureBuiltInRoles`. Built-in roles can be edited but not deleted, the
system administrator role is locked, and every role write is change-logged
under subject type `Role`. A user's permissions are reloaded on each
request, so a role edit takes effect on the user's next request.

Users manage their own account from the account menu: **Edit profile**
changes their name and email (an email change needs the current password,
since the email is the sign-in name), and **Change password** needs the
current password and signs out the user's other sessions. An administrator
holding `users.administer` can edit any user's name and email and reset a
password (which signs that user out everywhere) from Admin, Users. User
creates and edits are change-logged under subject type `User`, never with
the password hash. Sessions are tied to their user through
`session.userId` and the passport field in the session data
(`sessionsOfUser` in `api/src/auth/session-store.ts`).

The web app's root layout (`web/src/router.tsx`) gates every route on
`GET /auth/me`: while signed out it renders only the login form, and the nav
shell and all app routes stay hidden until sign-in succeeds.

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
