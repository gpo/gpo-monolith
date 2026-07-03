# GPO Monolith — Claude Guide

## What this repo is — and where it's going

The `gpo-monolith` is the Green Party of Ontario's backend code repo. It currently
contains a **legacy NestJS + MySQL application** (`src/`) of one-off scripts (CSV
imports, Google Drive jobs, PDF stamping).

**This repo is in transition.** The NestJS app is effectively **dead code slated for
removal**. New work is a **go-forward stack** tool — starting with the **Tax Receipts
& Contributions tool** under `apps/tax-receipts/`.

> ⚠️ **Do not build new features on the NestJS app in `src/`.** New code uses the
> go-forward stack (see below). If a task seems to call for extending `src/`, stop
> and confirm — it almost certainly belongs in `apps/`.

## Go-forward stack (all new work)

- **Backend:** Fastify + Zod (schema-first routes) + Prisma + PostgreSQL.
- **Frontend:** Vite + React + Mantine + Tanstack Router/Query.
- **Tooling:** Turborepo + pnpm, SWC, ESLint, Vitest.
- **Auth:** Passport + bcrypt, stateful sessions; authorization at the query layer
  (CASL + Prisma).

Rationale is recorded in `docs/tax-receipts-tool/decisions.md` (D1).

## Commands

> These are the **legacy** NestJS scripts. The go-forward tool will define its own
> pnpm/turbo scripts once scaffolded under `apps/`.

```bash
npm install          # install (legacy)
npm run build        # nest build
npm run start:dev    # watch mode
npm run test         # jest unit tests
npm run lint         # eslint --fix
```

## Layout

```
src/                       — legacy NestJS app (being retired; don't extend)
apps/                      — go-forward apps (tax-receipts tool lives here)
docs/tax-receipts-tool/    — project knowledge base for the receipts tool
docs/readme-images/        — README assets
google-workspace/          — Google API credential helpers
scripts/                   — misc scripts
```

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

## Conventions & hard rules

- **No CiviCRM integration.** CiviCRM is being decommissioned; the receipts tool
  reads from **Qomon + the BigQuery warehouse only**. (See `decisions.md` D2.)
- **Never hard-delete receipt data.** Corrections are cancel/void + an append-only
  change-log entry. This is a regulatory requirement (`compliance.md`).
- **Reporting reads hit the warehouse (BigQuery), not Qomon directly.**
- Keep this CLAUDE.md lean; put durable detail in `docs/tax-receipts-tool/`.
- Develop on the assigned feature branch; open a non-draft PR after pushing.
