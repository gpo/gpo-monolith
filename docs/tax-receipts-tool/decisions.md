# Architecture Decision Log — Tax Receipts & Contributions Tool

Director-approved decisions. **Do not relitigate these** without explicit sign-off;
if new information challenges one, raise it as an open question first.

Format: lightweight ADR (context → decision → consequences).

---

## D1 — Build on a go-forward stack, not the NestJS monolith

**Status:** Accepted · **Date:** 2026-06 · **Owner:** Ian Edington

**Context.** The existing `src/` NestJS + MySQL app is effectively dead code. The
*Review of Library/Framework Choices* (T. Dresser, Dec 2025) found NestJS
"constrained other library choices," had runtime-only OpenAPI, and hard-to-debug /
paywalled dependency injection.

**Decision.** New work uses:
- **Backend:** Fastify + Zod (schema-first) + Prisma + PostgreSQL.
- **Frontend:** Vite + React + Mantine + Tanstack Router/Query.
- **Tooling:** Turborepo + pnpm, SWC, ESLint, Vitest.
- **Auth:** Passport + bcrypt, stateful sessions; authorization at the query layer
  (CASL + Prisma) so per-entity (per-riding) access is enforced centrally.

**Consequences.** The tool lives under `apps/tax-receipts/{api,web}` with shared
`packages/`. The legacy NestJS app is slated for removal once the new tool stands on
its own (tracked separately; not blocking).

> Source: *Review of Library/Framework Choices*, in *Building a Better GVote – Notes*
> (Drive doc id `1HXr814b6B66upjQGdjMIcf4Bx9t7HbmIJPEJslYhfc8`).

---

## D2 — System of record is Qomon + the warehouse; no CiviCRM

**Status:** Accepted · **Date:** 2026-06 · **Owner:** Ian Edington

**Context.** GPO is replacing CiviCRM (and GVote) with **Qomon** + a BigQuery
warehouse; migration is scheduled for **late January 2027** with a parallel run.
Critically, **CiviCRM cannot attach two receipts to one contribution** — the exact
opposite of our core requirement (a contribution may back multiple receipts). The
new tool runs the **2026** receipt cycle, which happens *after* migration.

**Decision.** The tool integrates only with **Qomon** (system of record) and the
**BigQuery warehouse** (reporting read layer). **No CiviCRM adapter** is built.

**Consequences.** Reporting reads hit the warehouse, not Qomon directly. Receipt
data, allocations, the change-log, and (interim) contribution metadata live in our
own PostgreSQL. Phase 1 metadata write-back depends on Qomon custom transaction
fields (committed H2 2026) — see `open-questions.md` R1.

> Source: *GPO Technology Modernization Plan — Qomon*
> (Drive doc id `1BJWjPvOh6iDXQ4BFU_h6B8bJ7lIpMUs2mVX_RzusywE`).

---

## D3 — Deliver in independently-useful phases to a Jan-2027 full process

**Status:** Accepted · **Date:** 2026-06 · **Owner:** Ian Edington

**Context.** Hard external deadline (the 2026 AR-1 cycle, due May 31 2027) and a
late-Jan-2027 migration. Big-bang delivery is too risky.

**Decision.** Ship in phases, each independently useful:
1. Contributions: view → edit metadata → push back to Qomon.
2. Audit / validation (limits, residency, duplicates, periods).
3. Receipt issuance & corrections (allocation model, cancel/reissue/refund/move).
4. Elections Ontario reporting (per-entity AR-1 rosters + reconciliation).
5. Cutover & full 2026 cycle.

(Phase detail in `DESIGN.md` §7.)

**Consequences.** Each phase must stand alone. The allocation model and append-only
change-log are foundational and should be designed early even though full issuance is
Phase 3.

---

## How to add a decision

Append a new `## D<n> — <title>` section with Status/Date/Owner, then
Context / Decision / Consequences. Link the source. Keep entries short; the *why*
matters more than the *how*.
