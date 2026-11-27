# GPO Monolith: Claude Guide

## What this repo is, and where it's going

The `gpo-monolith` is the Green Party of Ontario's backend code repo. The legacy
NestJS + MySQL application that used to live in `src/` was **removed in #89**;
what remains today is the tax-receipt tooling that survives it (the receipt-PDF
generation script in `scripts/`, the Apps Scripts in
`google-workspace/` (EO reports, plus small Gmail, Docs, and Sheets
utilities), and the Cypress e2e tests in `gpoAutoTests/`) plus the
doc-memory system in `docs/`. This repo is the source of truth for the
tax-receipts tool (see below).

New work is a **go-forward stack** tool, starting with the **Tax Receipts &
Contributions tool** under `apps/tax-receipts/` (not yet scaffolded).

## Go-forward stack (all new work)

- **Backend:** Fastify + Zod (schema-first routes) + Prisma + PostgreSQL.
- **Frontend:** Vite + React + Mantine + Tanstack Router/Query.
  UI conventions for tables, modals, and buttons:
  [`docs/tax-receipts-tool/ui-patterns.md`](docs/tax-receipts-tool/ui-patterns.md).
- **Tooling:** Turborepo + pnpm, SWC, ESLint, Vitest.
- **Auth:** Passport + bcrypt, stateful sessions; authorization at the query layer
  (CASL + Prisma).

## Commands

There is no root build: the legacy NestJS app and its `package.json` are gone.
The go-forward tool will define its own pnpm/turbo scripts once scaffolded under
`apps/`. Today's runnable pieces:

```bash
node scripts/generate_tax_receipt_pdfs/generate.mjs   # stamp receipt PDFs from template
cd gpoAutoTests && npx cypress run                    # e2e autotests (see its README)
scripts/check-doc-sync.sh [<base>]                    # did mapped code change without its docs?
scripts/check-doc-freshness.sh                        # list overdue memory-doc reviews
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
