# GPO Monolith: Claude Guide

## What this repo is, and where it's going

The `gpo-monolith` is the Green Party of Ontario's backend code repo. Its main
project is the **Tax Receipts & Contributions tool**, a pnpm + Turborepo
workspace:

- `apps/tax-receipts/api` (Fastify api, plus the Qomon sweep worker),
  `apps/tax-receipts/web` (React app), and `apps/tax-receipts/e2e`
  (Playwright tests);
- `packages/` (`tax-receipts-core`, `qomon-client`, `warehouse-client`).

[`docs/tax-receipts-tool/architecture.md`](docs/tax-receipts-tool/architecture.md)
has the full layout. Older tooling remains alongside it: the receipt-PDF
script in `scripts/`, the Apps Scripts in `google-workspace/` (EO reports,
plus small Gmail, Docs, and Sheets utilities), and the legacy Cypress tests
in `gpoAutoTests/`. The legacy NestJS + MySQL app was removed in #89. This
repo is the source of truth for the tax-receipts tool (see below).

## Go-forward stack (all new work)

- **Backend:** Fastify + Zod (schema-first routes) + Prisma + PostgreSQL.
- **Frontend:** Vite + React + Mantine + Tanstack Router/Query.
  UI conventions for tables, modals, and buttons:
  [`docs/tax-receipts-tool/ui-patterns.md`](docs/tax-receipts-tool/ui-patterns.md).
- **Tooling:** Turborepo + pnpm, tsx, ESLint, Vitest, Playwright.
- **Auth:** Passport + bcrypt, stateful sessions; authorization at the query layer
  (CASL + Prisma).

## Commands

Run from the repo root (`architecture.md` has the details, including
environment files and the worker):

```bash
pnpm install
pnpm build                                      # generate the Prisma client, build packages
pnpm dev                                        # dev Postgres, migrate, api + web
pnpm check                                      # lint, typecheck, and unit tests
pnpm db:test:up                                 # Postgres for api tests (then export DATABASE_URL)
pnpm --filter @gpo/tax-receipts-e2e e2e         # Playwright e2e (see apps/tax-receipts/e2e/README.md)
scripts/check-doc-sync.sh [<base>]              # did mapped code change without its docs?
scripts/check-doc-freshness.sh                  # list overdue memory-doc reviews
node scripts/generate_tax_receipt_pdfs/generate.mjs   # legacy: stamp receipt PDFs from template
```

## Docs are shared memory

Version-controlled docs are how humans and agents share context across
ephemeral sessions. **`docs/README.md` describes the system; read it before
changing how docs work.** The working rules:

- **Before working in an area, read its docs.** `docs/doc-map.tsv` maps code
  areas to their docs; load only what the task needs.
- **After changing behaviour in a mapped area, update its docs in the same
  PR.** The Doc Sync check fails any PR that changes a mapped area without
  touching its docs; the **doc-sync** skill gives the guided path, and the
  `docs-not-needed` label overrides the check when a change genuinely has no
  doc impact.
- **Docs are reviewed on a schedule.** Frontmatter (`last-reviewed`,
  `review-interval-days`) drives a weekly workflow issue and
  `scripts/check-doc-freshness.sh`. To clear an overdue doc, run the
  **doc-review** skill.

## Project knowledge base

**This repo is the source of truth** for the Tax Receipts & Contributions
tool: its code, and its docs in
[`docs/tax-receipts-tool/`](docs/tax-receipts-tool/README.md). Load what the
task needs:

- [`architecture.md`](docs/tax-receipts-tool/architecture.md): code layout,
  how to run it, and how the main mechanisms work (contacts, Qomon sync,
  auth, receipts). Read before changing api or web behaviour.
- [`user-guide/`](docs/tax-receipts-tool/user-guide/README.md): what users
  see, area by area. Read before changing anything a user would notice.
- [`ui-patterns.md`](docs/tax-receipts-tool/ui-patterns.md): table, modal,
  and button conventions for the web app.

For Elections Ontario rules, check EO's own published requirements and
guidance directly, and cite the source and date in the doc you update. This
repo is public: keep internal strategy, stakeholder detail, and vendor
material shared in confidence out of it.

## Conventions & hard rules

- **The tool is the system of record** for contacts, memberships,
  contributions, and receipts. Data enters through the website forms, CFO
  uploads, and staff edits; Qomon gets a **one-way, read-only copy**, and
  nothing syncs back.
- **Never hard-delete receipt data.** Corrections are cancel/void + an append-only
  change-log entry. This is an Elections Ontario record-keeping requirement.
- **Reporting reads hit the warehouse (BigQuery), not Qomon directly.**
- Keep this CLAUDE.md lean; put durable detail in `docs/`.
- Writing style for docs: Canadian spelling, Oxford comma, no em-dashes, no
  horizontal rule directly above a header, text-based formats only.
