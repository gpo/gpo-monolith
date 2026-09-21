# Phase 4 — reviewer notes

Same running-notes pattern as [`PHASE-3-NOTES.md`](PHASE-3-NOTES.md).

## Ticket 4.1 — ALL report generator

Elections Ontario's per-entity annual contribution roster (eo-reporting.md
§2), plus the combined all-entities file EO also expects. S2P2 (ticket 4.2)
and the REP2-8 export gate (ticket 4.3) are separate tickets: this generator
reports what is issued, at any status; it does not block on validation
findings.

| Where | What |
|---|---|
| `packages/tax-receipts-core/src/reports/all-report.ts` | Pure column mapping: `buildAllReportRow`, `formatAllReportCsv`, and the three derivations pinned against the filed 2025 artifacts (research/fixtures/README.md, private repo) — `politicalEntityTypeLetter` (P/A/C), `receiptStatusLetter` (I/C, VOID files as C same as CANCELLED), `isAgencyContribution` (`received_by = GPO AND entity_kind != PARTY`, data-model.md §2 point 8, verbatim). |
| `apps/tax-receipts/api/src/reports/all-report.ts` | `generateAllReport`: fetches `Receipt`s scoped by period (+ridingNumber+entityKind for one entity's file, both omitted for the combined file), builds rows, writes the CSV as an `Artifact`, and records an `EntityReport` row (+ `EntityReportReceipt` links) in one change-logged write. |

Tests: `all-report.test.ts` in both packages — the core package pins the
column derivations in isolation, the api package covers per-entity vs.
combined scoping, REP7 retention, Agency_Contribution, G&S, and every error
path. `pnpm turbo run lint typecheck test build` green across
`tax-receipts-core`, `tax-receipts-api`, `tax-receipts-web`.

### Schema changes this ticket needed

1. **`Contact.firstName` / `Contact.lastName`** (nullable). The ALL file
   needs `Contributor_Last_Name` / `Contributor_First_Name` as separate
   columns; `Contact.name` is already a joined display string
   (`mirror-sweep.ts`'s `contactDisplayName`) with nothing to split back
   apart reliably. Qomon's own contact record already carries `firstname`/
   `surname` separately (`qomon-client/src/types.ts`) — this just persists
   what was already being thrown away, sourced from Qomon (D4: Qomon owns
   contacts), not guessed from the joined string. Falls back to `name` in
   the last-name slot when Qomon never supplied a split (e.g. an org-only
   contact), so no row loses the donor's identity outright.
2. **`EntityReport.entityKind` made nullable.** The schema (ticket 0.2) only
   modeled one `EntityReport` shape: one entity's own file. But
   eo-reporting.md §2 is explicit that EO also expects **combined**
   all-entities ALL and S2P2 files, and test-plan.md's F1 fixture explicitly
   covers both. Rather than inventing a second model or an artifact with no
   `EntityReport` row (losing `dirty`/`includedSet` tracking for the
   combined file, which ticket 4.5's diffing will want too), `entityKind:
   null` now means "the combined file" (with `ridingNumber` null alongside
   it); a non-null `entityKind` is one entity's file as before. Nothing
   wrote to this field before this ticket, so this was free to fix now.

### Deviations / judgment calls

1. **One contribution per receipt, still.** Same scope line ticket 3.1
   drew: a receipt with more than one allocation throws
   `MultiAllocationReceiptError` rather than guessing whose accepted date or
   non-deductible amount governs a shared receipt's row. No such receipt can
   exist today (3.1/3.12 only ever issue 1:1), so this is a forward guard.
2. **`Political_Entity` display name (e.g. "084 Parry Sound Muskoka") is
   caller-supplied**, via a `politicalEntityLabel` resolver function called
   per (ridingNumber, entityKind) — the same open gap tickets 3.1/3.12
   already flagged for issuance (no entity-name registry exists in the
   schema yet). This is now a second consumer of the same missing admin
   surface; see the private repo's open-questions.md O38.
3. **`Contributor_ID` (`ContributionMetadata.eoContributorId`) is emitted
   blank when unset**, which is the common case today — no ticket populates
   it, and the schema comment already marks it optional
   (data-model.md §3). EO's spec calls this mandatory for GPO
   (eo-reporting.md §1), so a report full of blank `Contributor_ID`s is not
   yet fully spec-compliant; tracked as O39 rather than fabricated here.
4. **F1 fixture byte-diff not run.** test-plan.md's F1 requires regenerating
   the period-64 and 2024-annual outputs and diffing byte-for-byte against
   the stored, filed CSVs — but those files carry donor PII and are kept out
   of both repos, fetched from Drive on demand
   (research/fixtures/README.md). No Drive access exists in this build
   environment, so F1 could not be run against the real artifacts this
   pass; the unit/integration tests above instead assert every individual
   derivation the README's "Verification facts" pin (REP7 retention,
   the S2P2 G&S/aggregation facts feed 4.2 not 4.1, MMDDYYYY, the P/A/C
   letters, `Agency_Contribution`'s formula). **Two formatting choices
   remain unverified against real bytes and are called out in
   `all-report.ts`'s header comment**: CSV quoting (minimal RFC4180
   quoting — a no-op on every field the verified facts describe as
   comma-free) and the line ending (`\n`). Whoever next has Drive access
   should run a real byte-diff and fix either if it's wrong before trusting
   F1's byte-for-byte claim.
5. **No route yet.** Ticket 4.5 owns the entity reports screen; this ticket
   is scoped to "generator plus fixture" per the backlog line, same as how
   1.7's validation engine landed before 1.8's queue screen/route.

## Ticket 4.2 — S2P2 report generator

Schedule 2 Part 2: the per-entity aggregate of over-$200 contributors, per
entity and combined, same split as ALL. Builds directly on 4.1: this ticket
factored 4.1's receipt-fetch + guards out into a shared
`load-receipts.ts` (both reports must agree on what's included — REP2 is a
per-entity total reconciling across the whole return) and factored the CSV
quoting/formatting out into `csv.ts`.

| Where | What |
|---|---|
| `packages/tax-receipts-core/src/reports/s2p2-report.ts` | `buildS2p2Rows`: groups by (contributor, entity type, specific entity) within a period, sums only `ISSUED` rows (REP7), keeps strictly > $200 (the $200.00 boundary is excluded — pinned against the filed data's minimum aggregate, $200.20), and reproduces the two S2P2-only quirks: `Contributor_Type` carries the entity letter here (not the donor's type like ALL), and returns `[]` when nothing clears the threshold. |
| `packages/tax-receipts-core/src/reports/csv.ts` | `formatReportCsv`, factored out of 4.1's `all-report.ts` so both reports share one quoting/line-ending implementation. |
| `apps/tax-receipts/api/src/reports/load-receipts.ts` | `loadReportReceipts` + the scope/multi-allocation/missing-metadata guards, factored out of 4.1's `all-report.ts` so ALL and S2P2 query the identical receipt set for a scope. |
| `apps/tax-receipts/api/src/reports/s2p2-report.ts` | `generateS2p2Report`: loads receipts, aggregates, and — only when at least one row clears $200 — writes the CSV artifact and an `EntityReport(kind: S2P2)` row. When nothing clears the threshold, **nothing is written**: no `Artifact`, no `EntityReport` (eo-reporting.md §2: "a period whose top aggregate does not exceed $200 emits no S2P2 file at all," e.g. the 2023 Kitchener Centre by-election). |

Tests: `s2p2-report.test.ts` in both packages, covering the aggregation rule
(sum ISSUED, exclude cancelled/void, strict >$200, per-entity not
cross-entity, per-specific-entity not just per-kind), the
never-collapse-on-missing-Contributor_ID grouping guard, the no-file case
(asserts zero `EntityReport`/`Artifact` rows get created), and combined vs.
per-entity scoping. `pnpm turbo run lint typecheck test build` green.

### Deviations / judgment calls

1. **`EntityReportReceipt` links (and `includedSet`) record only the
   receipts that fed a *surviving* (>$200) group.** A receipt whose group
   never cleared the threshold, or that was CANCELLED/VOID, isn't
   "included" by this report in the sense ticket 4.5's dirty-report
   tracking (E5) cares about — the artifact never reflects it. `core`'s
   `buildS2p2Rows` returns `includedReceiptIds` alongside the formatted
   rows so the caller doesn't have to re-derive group membership.
2. **Row order is a judgment call**, same category as `csv.ts`'s
   quoting/line-ending assumptions: sorted by (Political_Entity,
   Contributor_Last_Name, Contributor_First_Name) for deterministic,
   readable output. Unverified against the real filed byte order — the F1
   gap (below) covers this too.
3. **F1's byte-diff still not run**, same reason as 4.1 (no Drive access in
   this build environment) — now also covering S2P2's own verification
   facts (the G&S/aggregation rule, the exactly-$200 boundary population,
   the no-file-for-Kitchener-Centre case). All are covered by synthetic
   unit tests instead; a real byte-diff is still owed once someone has
   access.

## Ticket 4.3 — REP-rule gates (REP2-REP8)

eo-reporting.md §2: "report export runs REP2 to REP8; failures block export
with named rows." Reading each of the seven rules against what the tool can
actually check today split them three ways — see `rep-gate.ts`'s header
comment for the full reasoning per rule:

- **Genuinely new, checkable, and now enforced**: REP4 (every reported
  contribution maps to a valid EO entity — reuses `isEntityEligible`,
  already built for intake rule A2/A3) and REP6's period-window half
  (re-verifies the acceptance date against the period at export time, not
  just at intake, catching drift from a period edited after issuance).
- **Structurally guaranteed already, nothing to gate**: REP1, REP3
  (invariant-tested elsewhere), REP7, REP8 (built into how the ALL/S2P2
  generators share `load-receipts.ts`), and REP5's "agency flag consistent"
  half (`Agency_Contribution` is derived, not settable, so it cannot be
  inconsistent).
- **Not implementable yet — no data exists to check against**: REP2 ("equals
  the filed return total") and REP5's "5% agency fee reconciles against
  transfers" half need external data the tool doesn't model yet (an AR-1
  return total; `ReconciliationMark` transfer records, tickets 4.7/4.8).
  Logged as open-questions.md O40 rather than faked.

REP6 also has a non-blocking half: acceptance in year N with the deposit
processed in year N+1 is "flagged receivable", not rejected. Modeled as a
separate `receivable` list threaded through both generators' results (not
yet consumed anywhere — ticket 4.6's AR-1 "current-year notes for prior-year
corrections" is the eventual consumer) rather than dropped.

| Where | What |
|---|---|
| `packages/tax-receipts-core/src/reports/rep-gate.ts` | `runRepGate`: the pure REP4 + REP6 check, given already-fetched Period/Riding context. |
| `packages/tax-receipts-core/src/period/calendar.ts` | Exported the previously-private `contains` as `periodContainsInstant`, so REP6 can re-verify a specific period rather than duplicating containment logic. |
| `apps/tax-receipts/api/src/reports/load-receipts.ts` | `loadReportReceipts` now fetches the Period/Riding rows the loaded receipts reference, runs `runRepGate`, and throws `ReportExportBlockedError` (mirrors `SpaceIssuanceBlockedError`'s shape from ticket 3.12) before returning anything — so both ALL and S2P2 get the gate for free and neither can accidentally skip it. |

Tests: `rep-gate.test.ts` in both packages — the core package covers the pure
rule logic (entity validity across all three entity kinds and period kinds,
period-window drift, the receivable flag's non-blocking behaviour), the api
package proves the gate actually blocks `generateAllReport`/
`generateS2p2Report` end to end and that a blocked export writes nothing
(no `Artifact`, no `EntityReport`). `pnpm turbo run lint typecheck test
build` green.

### Deviations / judgment calls

1. **Existing 4.1 test fixture was wrong, not the gate.** 4.1's combined-file
   test issued a CAMPAIGN receipt against the baseline ANNUAL period — REP4
   correctly blocks that (a campaign is never eligible outside an election
   period). Fixed by giving that test its own `GENERAL_ELECTION` period
   rather than loosening the gate.
2. **The gate is unconditional, not opt-in.** Every call to
   `generateAllReport`/`generateS2p2Report` runs it; there is no bypass.
   Matches eo-reporting.md's "failures block export" language and the
   existing `SpaceIssuanceBlockedError` precedent (ticket 3.12) rather than
   adding a force-generate escape hatch nothing has asked for yet.

## Ticket 4.4 — ALL column-layout decision

Decided as decisions.md D10: emit EO's written 21-column spec layout for
the ALL file (adds `General_Meetings`, column F, always `N`), not the
20-column layout GPO's 2025/2024 filings actually used. Rationale: the
Evaluation Tool's rows 68/69 score reports against the spec document
itself, and the extra constant column is free insurance against a literal
column-count mismatch — see D10 for the full reasoning and the residual
risk (EO's actual answer to this question, asked directly in the
preliminary meeting brief, is still pending).

| Where | What |
|---|---|
| `packages/tax-receipts-core/src/reports/all-report.ts` | `ALL_REPORT_HEADER` gained `General_Meetings` between `Agency_Contribution` and `Political_Entity_Type`; `buildAllReportRow` emits it as a constant `'N'`. |

Two things noticed while doing this, neither addressed here (out of scope,
tracked as open questions):

1. **O41**: EO's spec's `Receipt_Status` column also allows a third value,
   `L` for "lost", which the tool doesn't emit — `Receipt.lost` is a
   separate boolean today. Natural to fold in alongside ticket 3.11.
2. The **S2P2 half of this same question** (spec says `Contributor_Type`
   should be `I`; GPO's accepted filings use the entity letter) is
   unchanged — ticket 4.2 already matches the accepted filings, and unlike
   the ALL column count, no default was recorded favouring the spec's
   reading there. Revisit both together if/when EO actually answers.

Tests: updated `all-report.test.ts` in both packages for the new column
(21-column header, the constant, and every hardcoded CSV-row assertion).
`pnpm turbo run lint typecheck test build` green.

## Ticket 4.5 — Entity reports screen + dirty-report diffing

screens.md screen 10: generate ALL/S2P2 per space, see the REP4/REP6 export
gate's result, and — rule E5, the "dirty flag" — exactly which included
records changed since generation and why (closes traceability.md gap 5,
the E3 story).

| Where | What |
|---|---|
| `packages/tax-receipts-core/src/reports/diff.ts` | `diffReportRows`: generic, pure row-set diff (`changed`/`added`/`removed`), keyed by a caller-supplied identity. `changed` is E5's dirty condition; `added`/`removed` are informational (a new receipt in scope isn't a correction to something already sent). |
| `apps/tax-receipts/api/src/reports/load-receipts.ts` | `EntityReportIncludedSet<Row>`: `includedSet` now stores the generated rows themselves, not just receipt ids — a true point-in-time snapshot, which is what the schema's own doc comment already called for. |
| `apps/tax-receipts/api/src/reports/entity-reports.ts` | `listEntityReports` / `checkEntityReportDrift` / `getEntityReportDetail` / `markEntityReportSentToCfo`. Drift is a **live recompute on read**, not a flag written by hooks scattered across every mutation path that could touch a reported row — same idiom `space/issuance.ts`'s gate already uses. `EntityReport.dirty` (the schema's own boolean column) is left unwritten; nothing persists a dirty flag back. |
| `apps/tax-receipts/api/src/routes/entity-reports.ts` | `GET /periods/:id/entity-reports` (list, riding-scoped), `POST /periods/:id/entity-reports` (generate, per-entity only), `GET /entity-reports/:id` (detail + diff), `GET /entity-reports/:id/csv` (download), `POST /entity-reports/:id/sent-to-cfo` (screen 10's send-to-CFO tracking — the `share` CASL action already existed for the organizer role, unused until now). |
| `apps/tax-receipts/web/src/routes/entity-reports.tsx` | The screen: generate form, report list with a dirty/clean/blocked badge, an expandable field-level diff table, CSV download, "mark sent" action. Reachable from a new "Reports" button on each space-dashboard row, same pattern as "Issue" (ticket 3.12). |

Tests: `diff.test.ts` (core), `entity-reports.test.ts` (api, both the module
and the route layer — including a REP4-gate-blocked generation returning
409 with named findings), `entity-reports.test.tsx` (web). `pnpm turbo run
lint typecheck test build` green (199 api tests, 28 web tests, 191 core
tests).

### Deviations / judgment calls

1. **Only per-entity generation is exposed via HTTP/UI.** The combined
   all-entities file (also built in 4.1/4.2) stays callable only from
   server-side code. A combined report spans many political entities with
   no single label to collect in one form — that's O39's entity-name-
   registry gap, not something to solve by inventing UI for it here.
   Combined reports also aren't drift-checked for the same reason (`dirty:
   null`, surfaced distinctly from `true`/`false` rather than guessed).
2. **Drift-checking rebuilds the full row set for the report's scope and
   diffs it whole**, rather than trying to patch/diff a subset. For S2P2
   this is the only correct option (rows are per-group aggregates, not
   per-receipt); for ALL it's simpler and gives added/removed detection for
   free. The label used to rebuild is read back from the stored rows
   themselves (`Political_Entity`), not re-collected from the caller — one
   space has one label, so nothing new is needed to check for drift, only
   to generate a fresh report.
3. **No persistence of the dirty flag.** `checkEntityReportDrift` runs on
   every list-screen load; for the realistic scale here (at most a few
   hundred entities per period) that's cheap enough. A future ticket
   wanting a cheap, indexable "which reports are dirty" query without a
   live recompute per row would write `EntityReport.dirty` back from this
   same check.
4. **CASL**: added `create` on `EntityReport` for `party_cfo`, `bookkeeper`,
   and `filer` (screens.md's named personas for screen 10); `share`
   (send-to-CFO) already existed for `organizer` and is now also granted to
   `party_cfo`/`filer`, since either plausibly sends a report themselves.
5. **REP4-gate test setup was more involved than expected**: constructing a
   receipt that fails the gate meant hand-building a Receipt +
   ReceiptAllocation directly (bypassing `issueReceipt`, which has no
   opinion about report-export validity) rather than reusing the usual
   fixture helper. Documented inline in the test rather than extending
   `test/db.ts` for a one-off case.
