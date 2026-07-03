---
last-reviewed: 2026-07-03
review-interval-days: 90
---

# GPO Monolith — Claude Guide

## What this repo is — and where it's going

The `gpo-monolith` is the Green Party of Ontario's backend code repo. The legacy
NestJS + MySQL application that used to live in `src/` was **removed in #89**;
what remains today is the tax-receipt tooling that survives it (PDF generation
script, EO-report Apps Script, Cypress e2e tests) plus the project knowledge
base.

New work is a **go-forward stack** tool — starting with the **Tax Receipts &
Contributions tool** under `apps/tax-receipts/` (not yet scaffolded).

## Go-forward stack (all new work)

- **Backend:** Fastify + Zod (schema-first routes) + Prisma + PostgreSQL.
- **Frontend:** Vite + React + Mantine + Tanstack Router/Query.
- **Tooling:** Turborepo + pnpm, SWC, ESLint, Vitest.
- **Auth:** Passport + bcrypt, stateful sessions; authorization at the query layer
  (CASL + Prisma).

Rationale is recorded in `docs/tax-receipts-tool/decisions.md` (D1).

## Commands

There is no root build: the legacy NestJS app and its `package.json` are gone.
The go-forward tool will define its own pnpm/turbo scripts once scaffolded under
`apps/`. Today's runnable pieces:

```bash
node scripts/generate_tax_receipt_pdfs/generate.mjs   # stamp receipt PDFs from template
cd gpoAutoTests && npx cypress run                    # e2e autotests (see its README)
scripts/check-doc-freshness.sh                        # list overdue memory-doc reviews
```

## Layout

```
apps/                      — go-forward apps (tax-receipts tool will live here)
docs/                      — shared memory (see below); README.md explains the system
docs/tax-receipts-tool/    — knowledge base for the receipts tool
docs/qomon/                — Qomon OpenAPI specs (confidential; snapshots from Qomon)
google-workspace/          — Apps Script sources (EO-report splitter)
gpoAutoTests/              — Cypress e2e autotests
scripts/                   — receipt-PDF generation, doc-freshness checker
```

## Docs are shared memory

Version-controlled docs are how humans and agents share context across
ephemeral sessions. **`docs/README.md` describes the system; read it before
changing how docs work.** The working rules:

- **Before working in an area, read its docs.** `docs/doc-map.tsv` maps code
  areas to their docs; load only what the task needs.
- **After changing behaviour in a mapped area, update its docs in the same
  PR.** A Stop hook reminds you if you forget; the **doc-sync** skill gives
  the guided path.
- **Docs are reviewed on a schedule.** Frontmatter (`last-reviewed`,
  `review-interval-days`) drives a SessionStart notice, a weekly workflow
  issue, and `scripts/check-doc-freshness.sh`. To clear an overdue doc, run
  the **doc-review** skill.

## Project knowledge base

**Working on the Tax Receipts & Contributions tool? Read `docs/tax-receipts-tool/`
first.** Load only what the task needs:

- [`docs/tax-receipts-tool/DESIGN.md`](docs/tax-receipts-tool/DESIGN.md) — design &
  phased roadmap (start here).
- [`docs/tax-receipts-tool/glossary.md`](docs/tax-receipts-tool/glossary.md) —
  domain terms (CA, TRR, AR-1, S2P2, CFO, target entity, agency fee…). Read this if
  any term is unfamiliar.
- [`docs/tax-receipts-tool/compliance.md`](docs/tax-receipts-tool/compliance.md) —
  Elections Ontario rules (limits, deadlines, receipt numbering, retention).
- [`docs/tax-receipts-tool/integrations.md`](docs/tax-receipts-tool/integrations.md)
  — Qomon API + BigQuery warehouse facts and constraints.
- [`docs/tax-receipts-tool/decisions.md`](docs/tax-receipts-tool/decisions.md) —
  architecture decision log (don't relitigate these).
- [`docs/tax-receipts-tool/open-questions.md`](docs/tax-receipts-tool/open-questions.md)
  — living list of risks / unknowns to close.
- [`docs/qomon/`](docs/qomon/README.md) — raw Qomon OpenAPI specs (shared in
  confidence; do not redistribute).

## Conventions & hard rules

- **No CiviCRM integration.** CiviCRM is being decommissioned; the receipts tool
  reads from **Qomon + the BigQuery warehouse only**. (See `decisions.md` D2.)
- **Never hard-delete receipt data.** Corrections are cancel/void + an append-only
  change-log entry. This is a regulatory requirement (`compliance.md`).
- **Reporting reads hit the warehouse (BigQuery), not Qomon directly.**
- Keep this CLAUDE.md lean; put durable detail in `docs/`.
- Writing style for docs: Canadian spelling, Oxford comma, no em-dashes, no
  horizontal rule directly above a header, text-based formats only.
- Develop on the assigned feature branch; open a non-draft PR after pushing.
