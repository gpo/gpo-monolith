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
