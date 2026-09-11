# Phase 1 — reviewer notes

Branch: `tax-receipts/phase-1`, off `tax-receipts/phase-0` (PR #98, not yet
merged to main as of 2026-09-11 — see the kickoff prompt in
`qomon-migration-documents/tax-receipts/design/phase-1-kickoff-prompt.md`).
Updated incrementally as tickets land, same pattern as
[`PHASE-0-NOTES.md`](PHASE-0-NOTES.md).

## Ticket 1.1 — Mirror sweep

Spec: data-model.md §5. STATUS.md row moved to `review`.

| Where | What |
|---|---|
| `packages/tax-receipts-core/src/sync-hash.ts` | `computeContributionSyncHash`: drift-detection hash over the Qomon-owned transaction fact fields (amount, currency, date, contact, payment method, status, campaign code, comment, external id). Deliberately separate from `computeMetadataChecksum` (metadata.ts), which covers only the descriptive metadata object. |
| `packages/tax-receipts-core/src/intake/defaults.ts` | `deriveIntakeDefaults` — **a stub**. Resolves `period_id` from the acceptance date via the period calendar (0.6, unblocked); `riding_number`, `entity_kind`, and `received_by` are always the documented fallback (null / PARTY / GPO, flagged) because the real rules (subspace riding, "directed-to" entity kind, provenance) are ticket 1.6 and additionally blocked on B3/B8. Ticket 1.6 replaces this function's body; callers (the sweep) don't change. |
| `apps/tax-receipts/api/src/sync/mirror-sweep.ts` | `runMirrorSweep(deps, opts)`. Two modes: `incremental` (default, resumes from the persisted cursor) and `full` (ignores the cursor, and — only when the pull wasn't truncated by `limit` — flags contributions missing from Qomon as `SYNC_INCIDENT` work items, never a silent delete). Per data-model §5's decision node: unchanged → no-op; new → mirror + intake defaults + one `VALIDATION` work item; changed + not receipted/reported → refresh cache directly; changed + receipted/reported → `DIFF` work item, facts **not** overwritten (that would risk tripping invariant 1's allocation-sum check and pre-empts the Phase 3 correction workflow). Contact sync is on-demand only (fetch on first sight of a `contact_id`); the "nightly sweep of contacts on unissued receipts" has no receipts to refresh yet (Phase 3) and is out of scope here. |
| `apps/tax-receipts/api/prisma/schema.prisma` (`SyncCursor`, migration `20260911130832_sync_cursor`) | One row per `ChangeFeedSource.kind`, so an incremental sweep resumes across process restarts. Not a data-model §2 entity — sync bookkeeping, same category as the three Phase 0 infra tables. |
| `apps/tax-receipts/api/src/routes/sync.ts` | `POST /internal/sync/sweep`, sysadmin-only. Registers only when a `qomon` client is injected into `buildApp` (i.e. `QOMON_API_KEY` is set); otherwise the route doesn't exist (404). A real schedule is ticket 1.15 (ops monitoring); this is the manual trigger until then. |
| `apps/tax-receipts/api/src/env.ts`, `src/server.ts` | `QOMON_API_KEY` / `QOMON_API_BASE`, both optional — unset in most environments until B5/B6 land. |

Tests: `packages/tax-receipts-core/src/sync-hash.test.ts`,
`src/intake/defaults.test.ts`; `apps/tax-receipts/api/src/sync/mirror-sweep.test.ts`
(new transaction + stub defaults + on-demand contact fetch + contact reuse;
no period configured → mirrored without metadata, flagged; later backfill
once a period exists; non-receipted refresh; receipted → diff queue,
facts untouched, no duplicate work items on re-sweep; Qomon-side deletion →
sync incident; incremental idempotency via the persisted cursor; metadata
already present on the transaction is cached directly, no derivation). Route
auth test in `src/routes/sync.test.ts`. `pnpm turbo run lint typecheck test
build` green, 20/20 tasks.

### Deviations / judgment calls

1. **1.1 vs 1.6 boundary.** The data-model §5 flowchart shows "create mirror
   + metadata defaults (§6)" as one step on a new transaction, but §6's real
   rules are ticket 1.6 and partly blocked (B3, B8). 1.1 ships a stub
   (`deriveIntakeDefaults`) that gets `period_id` right and flags everything
   else, so every new contribution lands in the validation queue by
   construction. If the intent was for 1.1 to defer metadata creation
   entirely until 1.6, that's a one-line change (drop the `else` branch in
   `ingestNewContribution`); flagging here since it's a judgment call, not a
   spec-explicit choice.
2. **Diff-queued contributions don't get their mirror facts refreshed**, on
   purpose: the changed fields on a receipted/reported contribution are
   exactly the correction workflow's job (Phase 3). Only `lastSyncedAt`
   moves; the stale `syncHash` means the diff keeps re-surfacing every sweep
   until resolved, by design (idempotent, no duplicate `DIFF` items).
3. **Full-sweep deletion detection only runs when the pull wasn't truncated**
   (`!batch.hasMore`) — a partial pull can't safely conclude anything is
   missing. Full-mode default limit is 100k transactions; large enough to
   cover the expected space in one call today, revisit if that stops holding.
4. **No S3 change-dump feed** (O28): only `QomonPollChangeFeed` exists
   (built in 0.8). `ChangeFeedSource` stays the abstraction point.

## Ticket 1.2 — Metadata model + write-through

Spec: data-model.md §5 "Tool edit (write-first, Qomon is truth)", D4.
STATUS.md row moved to `review`.

| Where | What |
|---|---|
| `apps/tax-receipts/api/src/contributions/metadata-cache.ts` | Extracted from 1.1's `mirror-sweep.ts`: `isReceiptedOrReported` and `descriptiveToRow`, now shared by the sweep and the write-through service — both cache a `GpoMetadataDescriptive` into `ContributionMetadata`, and both must refuse a contribution already backing an ISSUED receipt or an RTD filing. |
| `apps/tax-receipts/api/src/contributions/metadata-write-through.ts` | `writeContributionMetadata(deps, input)`: PATCHes the whole metadata object to Qomon first (no partial merges — the checksum covers the whole object); only on a **confirmed** echo (recomputes the checksum from what Qomon echoed back, never trusts the echoed checksum field itself, matching 1.1's "echoes are never truth" rule) does it commit cache + change-log locally, in one `withChangeLog` transaction. Blocks the edit outright (`MetadataWriteBlockedError`, 409) once the contribution backs an ISSUED receipt or an RTD filing — that's invariant 6 / the Phase 3 correction workflow's job, not a plain edit's. `QomonWriteRejectedError` (502) for a failed PATCH, `QomonWriteUnconfirmedError` (502) when the echo doesn't match, `ContributionNotFoundError` (404). |
| `apps/tax-receipts/api/src/routes/contributions.ts` | `PATCH /contributions/:id/metadata`. Registers always (unlike the 1.1 sync trigger) but returns 501 until a Qomon client is configured — editing is core path, so its absence should read as "not configured," not "route doesn't exist." Gated on `ability.can('update', 'ContributionMetadata')`; no per-riding scoping yet (matches every other route today — none scope by riding; revisit with 1.3/1.5). |
| `apps/tax-receipts/api/src/app.ts` | Registers the new route; error handler grows four cases (404/409/502×2) following the existing per-error-class `instanceof` pattern (`IssuanceDisabledError`, `ChangeLogError`). |

Tests: `metadata-write-through.test.ts` (success writes Qomon-then-cache in
that order and stamps actor+reason; whole-object replace, not merge; a
failed Qomon PATCH touches nothing locally; an unconfirmed echo is refused
even though the PATCH itself succeeded; blocked once receipted, and the
block happens *before* any Qomon call; unknown contribution id).
`routes/contributions.test.ts` (501 unconfigured; write-through end to end
through the HTTP layer with a real session; 403 for a role without the
`update` grant). `pnpm turbo run lint typecheck test build` green, 20/20
tasks, 132 tests across the workspace.

### Deviations / judgment calls

1. **Crash-consistency is sweep-mediated, not two-phase-commit.** If the
   process dies between a Qomon-confirmed write and the local commit, the
   cache is stale until the next mirror sweep notices the checksum drift and
   self-heals it (1.1's refresh path) — attributed to the system actor, not
   the original edit's actor/reason. This satisfies "crash-consistent" (no
   corruption, no lost Qomon state) but not "the change-log always has the
   original reason." Flagging since a true two-phase protocol was not built.
2. **No riding-scope check on the route** (see table above) — consistent
   with the rest of the codebase today, not a regression introduced here.
3. **B5 still open**: nothing here is blocked by it — `qomon-client`'s
   `writeTransactionMetadata` already models the field (0.8), so this ticket
   writes against that contract. The fallback in data-model §1 (cache as
   interim store of record) only matters once a real Qomon PATCH is attempted
   against a Qomon that rejects an unknown `metadata` key; no evidence either
   way yet (untested against the live sandbox for this field per
   PHASE-0-NOTES.md).

## Ticket 1.6 — Intake derivation defaults

Spec: data-model.md §6, invariant 8, validation-rules.md rule A7.
STATUS.md row moved to `review`.

Replaces 1.1's flagged-everything-but-period stub
(`packages/tax-receipts-core/src/intake/defaults.ts`) with the real rule set
— to the extent B3/B8 allow (both still open as of 2026-09-11; per the
kickoff prompt's ground rule, the blocked parts stay the documented
fallback, flagged, not guessed):

| Field | What changed | Still blocked on |
|---|---|---|
| `period_id` | Now scoped by the derived riding (below), so by-election periods resolve correctly instead of always falling through to the party-wide annual period. | nothing |
| `riding_number` | New `packages/tax-receipts-core/src/source-code.ts`: `parseRidingFromSourceCode` extracts rule A7's directed riding segment (`TSF.W.007` → 7); an undirected code (`NC.W.DON.DBK.BTN50`) or none still falls back to null, flagged. | subspace-based derivation (B3) |
| `received_by` | Invariant 8's "a processor record forces GPO" clause is applied (a non-empty `external_ref` is the signal) — confident, unflagged. | distinguishing CFO-subspace (ENTITY) from central-manual (GPO) when there's no processor record — same space-identification gap as riding (B3) |
| `entity_kind` | Unchanged: always PARTY, flagged. D6 forbids deriving it from the space regardless of any blocker, and no "directed-to" field/convention exists yet. | B8 |

`IntakeDefaultsResult.flags` replaced the old single `flagged`/`flagReason`
pair with `Array<{ field, reason }>` — one entry per field that couldn't be
derived with confidence, so a field that *is* now derivable (riding via a
directed source code, received_by via a processor record) stops being
flagged instead of the whole row staying uniformly flagged. The mirror sweep
(1.1) doesn't consume `.flags` yet — it only reads `.descriptive`/`.periodId`
— since turning per-field flags into WorkItem detail is validation-engine
territory (ticket 1.7), not this ticket's.

Tests: `packages/tax-receipts-core/src/source-code.test.ts`,
`src/intake/defaults.test.ts` (rewritten for the new `flags` shape, directed
vs undirected codes, processor-record received_by, by-election period
scoping via the derived riding). 1.1's `mirror-sweep.test.ts` needed no
changes — its fixtures all use undirected/absent source codes, so the
observed behaviour didn't move. `pnpm turbo run lint typecheck test build`
green, 20/20 tasks, 74 core tests + 57 api tests.

### Deviations / judgment calls

1. **`received_by` defaults GPO, not ENTITY, when there's no processor
   record.** Invariant 8 names both "CFO subspace entry defaults ENTITY" and
   "central manual entry defaults GPO" as the two fallbacks for a
   non-processor record, and nothing here can tell which case applies
   (that's the same B3 gap). GPO was picked as the safer conservative
   default — flagged either way, so a human confirms it — rather than
   guessing ENTITY for what might be the more common CFO-entry case.
2. **Source-code riding parsing accepts any in-range all-digit trailing
   segment**, not strictly the 3-digit zero-padded form the two rule A7
   examples show, so an under-padded code isn't silently dropped. Documented
   in `source-code.ts`; revisit if real source codes turn out to need
   stricter matching.

## Ticket 1.7 — Validation engine v1

Spec: validation-rules.md. STATUS.md row moved to `review`. New open question
**O34** raised (below).

Phase 1 pulls forward a *subset* of the full A/B/C catalogue — the rules
checkable with data this phase actually populates. Full coverage is Phase 2
ticket 2.1 (backlog.md already frames 1.7 this way). Implemented:

| Rule | Where | Note |
|---|---|---|
| A1 period window | `packages/tax-receipts-core/src/validation/rules.ts` | acceptance date inside the period's bounds |
| A2 riding/entity consistency | same | range + PARTY-has-no-riding / CA·CAMPAIGN-needs-one; the "active campaign for the period" half is not checked (no campaign roster exists yet) |
| A5 non-deductible | same | non-deductible ≤ amount, eligible > 0; the "or marked non-receiptable" half has no field to check (none exists) |
| A6 duplicate contribution **[EO]** | same | same donor + amount + entity within ±3 days (a judgment call, not spec-given), or a matching `external_ref` |
| A7 source-code riding | same | reuses 1.6's `parseRidingFromSourceCode`; compares the parsed riding against metadata |
| A8 cash limit | same | $25 EFA cash limit |
| B2 over-limit **[EO]** | same | wraps 0.7's `evaluateLimits` directly; `candidateSelf`/`leadership` are always false (no data source for either flag yet) |
| B4 duplicate contributor **[EO]** | same | only the email-match half; "same name + address" needs `AddressSnapshot` data, not populated yet |

Not implemented, and why: A3/A4/A9/B1/B3/B5/C1-C5 need data no ticket
populates yet (active-entity roster, invoices, addresses); REP* are
report-generation-time (Phase 4); E1/E4 are already structurally enforced by
1.1's sweep itself, not separate rules to re-run; E2/E3/E5 need RTD
inclusions/receipts/entity reports (Phase 2/3/4). **B1 (ineligible
contributor, out-of-province) is the one gap worth flagging loudly**: it's
one of the four flag types EO's Evaluation Tool explicitly mandates, and the
other three (A6, B2, B4) now have v1 coverage — B1 alone is blocked on
address data. Raised as **O34** in open-questions.md rather than silently
dropped, since it bears on the Nov 16 pre-evaluation checklist.

**Architecture**: `packages/tax-receipts-core/src/validation/rules.ts` holds
pure rule functions (`runContributionRules` is the registry entry point);
`apps/tax-receipts/api/src/validation/run.ts` assembles the DB-side context
(candidate duplicates, year-to-date contributions, limit rows, contact
matches) and reconciles findings against `WorkItem` rows — one row kept per
(contribution, ruleRef) over time:

- a finding with no existing WorkItem → open one (`OPEN`);
- a finding whose WorkItem is `RESOLVED`, or `EXCEPTION` **from a prior ET
  calendar year**, → reopen the *same* row (data-model §2: "exceptions
  expire at year-end"), change-logged;
- a finding whose WorkItem is already `OPEN`, or `EXCEPTION` from the
  *current* year → leave it;
- an `OPEN` WorkItem whose rule no longer fires → auto-resolve, change-logged
  (`resolutionNote: 'auto-resolved: condition no longer applies'`).

`apps/tax-receipts/api/src/work-items/resolve.ts` is the separate
staff-driven resolution primitive (`resolveWorkItem`, RESOLVED or EXCEPTION
outcome, mandatory reason, change-logged) — generic across every WorkItem
kind, not just VALIDATION, per data-model's one-table-four-queues design.
Typed fix actions (reallocate, refund, merge — validation-rules.md's list)
are later work; this ticket is only the close/except primitive itself.

**Wiring** (validation-rules.md "when rules run"): the mirror sweep (1.1)
calls the registry on intake (after metadata is created or backfilled) and
the metadata write-through (1.2) calls it after every edit. A manual
sysadmin-only `POST /internal/validation/run` stands in for "nightly" until
a real schedule exists (ticket 1.15), same pattern as 1.1's sync trigger.

**1.6 integration**: `deriveIntakeDefaults`' per-field `flags` (added in
1.6, unused until now) turn into their own WorkItems, `ruleRef` prefixed
`INTAKE:` (e.g. `INTAKE:riding_number`) — a distinct concern from
validation-rules.md's registry (an intake flag means "couldn't derive this
with confidence," not "violates a rule"), so `run.ts`'s reconciliation
explicitly excludes that prefix: it never auto-resolves or reopens an intake
flag it didn't create and has no way to re-evaluate. This replaces 1.1's
original single ruleRef-less "new contribution" WorkItem with one item per
actually-uncertain field, which also fixed a latent gap: a stub-derived
contribution with the *default* values (PARTY, no riding) coincidentally
satisfies rule A2 (PARTY-has-no-riding is valid), so without the intake
flags such a row would have surfaced in **no** queue at all.

Tests: `packages/tax-receipts-core/src/validation/rules.test.ts` (27 cases,
one/none-per-rule plus the aggregator); `apps/tax-receipts/api/src/validation/run.test.ts`
(open-per-finding, auto-resolve-then-reopen on the same row, current-year
exception left alone vs prior-year exception reopened, A6/B4/B2 wired
through real DB queries, the nightly sweep skips contributions with no
metadata); `work-items/resolve.test.ts`. 1.1's `mirror-sweep.test.ts` updated
for the new per-field intake WorkItems (was asserting exactly one
ruleRef-less item). `pnpm turbo run lint typecheck test build` green, 20/20
tasks, 108 core tests + 76 api tests.

### Deviations / judgment calls

1. **One WorkItem row per (contribution, ruleRef), reused across
   open/resolve/reopen cycles**, rather than a fresh row each time a rule
   re-fires. Keeps exactly one queryable history per issue instead of
   accumulating duplicates release over release; the change-log carries the
   full history of status transitions regardless.
2. **A6's duplicate window (±3 days) is a judgment call**: validation-rules.md
   says "within a window" without a number. Revisit once real duplicate
   cases are seen (test-plan drills / the pilot).
3. **B2 always attributes via entity kind only** (never LEADERSHIP or
   CANDIDATE_SELF) since no field carries `candidateSelf`/`leadership` yet.
   Not a Phase 1 gap by itself — those buckets need their own data source,
   likely a later ticket.
4. **O34 (B1 not implemented)** — see table above; flagged rather than
   silently dropped given EO's explicit mandate.

## Ticket 1.3 — Contributions list

Spec: screens.md 2, PRD C1. STATUS.md row moved to `review`. Read-only: bulk
edit (1.4) and the detail screen (1.5) are separate tickets.

| Where | What |
|---|---|
| `apps/tax-receipts/api/src/contributions/list.ts` | `listContributions`: server-side filters (period, riding — including an explicit party-level-only filter — entity kind, received-by, donor name/email substring, amount range, date range, open-validation status and a specific `ruleRef`, receipt state) plus cursor pagination. `WorkItem` has no Prisma relation to `Contribution` (`subjectId` is a loose string shared by four subject types), so validation-status filtering runs as a separate lookup rather than a nested relation filter. |
| `apps/tax-receipts/api/src/routes/contributions.ts` | `GET /contributions`, zod query-param coercion, applies per-riding access scope (`user.allRidings ? null : user.ridingGrants`) — the first route in the app to actually apply it; party-level rows stay visible to everyone regardless of grants. |
| `apps/tax-receipts/web/src/routes/contributions.tsx` | The list screen: filter form, a Mantine `Table`, a column picker, and saved filters. Column visibility and saved filters are both `localStorage`-only (no `SavedFilter` entity exists in data-model.md, and none is warranted for a v1 per-browser convenience). |

Tests: `list.test.ts` (11 cases covering every filter plus riding scope and
pagination), a `GET` case in `routes/contributions.test.ts`,
`routes/contributions.test.tsx` (renders rows, a filter input re-queries
with the right query param, the column picker hides a column, saved
filters persist to `localStorage`). `pnpm turbo run lint typecheck test
build` green, 20/20 tasks, 88 api tests + 5 web tests.

### Deviations / judgment calls

1. **Mantine's `Select` (Combobox-based) hangs test mounts under jsdom** —
   confirmed by bisection (removing it fixed an otherwise-unexplained
   5-second render freeze in `pnpm --filter @gpo/tax-receipts-web test`);
   root cause not chased further (likely a Floating UI positioning loop
   jsdom can't satisfy). Both filter/loader dropdowns use `NativeSelect`
   instead, and the column picker uses a plain toggled `Paper` rather than
   Mantine's `Menu` (same Floating UI family) — confirmed same failure mode
   opening it. `apps/tax-receipts/web/src/test/setup.ts` also gained
   `ResizeObserver` and `scrollIntoView` stubs either way, since Mantine's
   floating/combobox components need them regardless of which ones this
   screen ends up using. **Flag for whoever builds 1.4/1.5/1.8/1.10**: if a
   later screen needs an actual `Select`/`Menu`/`Popover`, expect the same
   issue and budget time to either chase the real fix or take the same
   native-element workaround.
2. **No `SavedFilter` entity** — see table above; revisit if saved filters
   need to sync across a user's devices.

## Ticket 1.5 — Contribution detail

Spec: screens.md 3, PRD C3/C4. STATUS.md row moved to `review`.

| Where | What |
|---|---|
| `apps/tax-receipts/api/src/contributions/detail.ts` | `getContributionDetail`: Qomon facts, metadata, allocations + their receipts, RTD inclusions, every WorkItem, and the change-log slice for `Contribution`/`ContributionMetadata` subjects. Applies the same riding scope as 1.3's list (a row outside scope reads as not-found, not 403 — avoids confirming existence to an unauthorized viewer). |
| `apps/tax-receipts/api/src/contributions/refresh.ts` | `refreshContributionFromQomon`: the "refresh from Qomon" action (data-model §5: gate reads re-fetch live by id). Re-fetches the bundle and runs the transaction through 1.1's own `ingestChange` (now exported from `mirror-sweep.ts`, along with `loadPeriods`) — same diff-queue protection and metadata handling the scheduled sweep would apply, just on demand. |
| `apps/tax-receipts/api/src/routes/contributions.ts` | `GET /contributions/:id`, `POST /contributions/:id/refresh` (501 unconfigured, matching 1.2's pattern). |
| `apps/tax-receipts/web/src/routes/contribution-detail.tsx` | The detail screen at `/contributions/$id`, linked from 1.3's list (donor name). Read-only Qomon facts panel with the refresh button and sync-incident alert; an editable metadata form (same fields as 1.2's write-through, reason required, save disabled until one is entered); work items, allocations/receipts, and change-log panels — all empty-state today since Phase 3 doesn't exist yet, but wired correctly. |

Tests: `detail.test.ts` (unknown id, full detail shape, allocations +
receipt join, riding-scope hides an out-of-grant row but not a party-level
one), `refresh.test.ts` (unmirrored id throws, a non-receipted refresh
updates the cache, a receipted refresh routes to the diff queue and leaves
facts untouched, a transaction missing from its bundle is a no-op),
`contribution-detail.test.tsx` (renders facts/metadata/work items/change-log,
refresh button calls the endpoint, save is disabled until a reason is
typed). `pnpm turbo run lint typecheck test build` green, 20/20 tasks, 96
api tests + 8 web tests.

### Deviations / judgment calls

1. **Out-of-scope rows 404, not 403** — consistent with not confirming a
   resource's existence to a viewer who can't see it.
2. **Reused 1.1's `ingestChange` rather than writing a second ingestion
   path** for the refresh action — the alternative (a parallel "fetch one,
   apply directly") would have to re-implement the diff-queue check and
   metadata handling and could drift from the sweep's behaviour over time.

## Ticket 1.4 — Bulk edit

Spec: screens.md 2, PRD C2. STATUS.md row moved to `review`.

| Where | What |
|---|---|
| `apps/tax-receipts/api/src/contributions/bulk-edit.ts` | `bulkEditContributionMetadata`: one reason, one set of field changes, applied to every selected row. Each row merges server-side (its current metadata + the requested changes) before calling 1.2's `writeContributionMetadata` unchanged — so it gets the same write-first protocol, the same block on a receipted/reported row, and its own change-log entry (PRD C2: "one change-log entry per row"). One row's failure doesn't stop the batch; capped at `BULK_EDIT_MAX_ROWS` (500) to keep one HTTP request's synchronous processing time bounded. |
| `apps/tax-receipts/api/src/routes/contributions.ts` | `POST /contributions/bulk-edit`. |
| `apps/tax-receipts/web/src/routes/contributions.tsx` | Row selection checkboxes (plus "select all visible") and a bulk-action bar: pick one field, enter its new value, mandatory reason, apply. Results show as a summary alert (succeeded/failed counts); failed rows stay selected for a retry. |

**"Per-row progress" reads as "you see each row's outcome," not a live
progress bar** — there's no job-queue/SSE infrastructure to stream updates,
so the bar shows a loading state during the request and the full per-row
result set once it resolves. The bulk-edit bar exposes one field at a time
from a fixed set (period, riding, entity kind, received-by, non-deductible,
source code) — the common cases (PRD C2's period-reassignment example) —
not every field the API accepts; `goodsServices`, `processedDate`,
`eoContributorId`, and `exceptionReason` stay per-row edits on the detail
screen (1.5).

Tests: `bulk-edit.test.ts` (merges one field and leaves the rest alone,
explicit null for party-level reassignment, a bad row doesn't stop the
batch and reports its own error, a receipted row fails without being
touched, empty changes and over-cap batches rejected), a route test, and a
`contributions.test.tsx` case (select a row, fill the bar, apply, see the
result). `pnpm turbo run lint typecheck test build` green, 20/20 tasks,
104 api tests + 9 web tests.

### Deviations / judgment calls

1. **Server-side merge, not a client-known full object** — the client only
   ever sends the field(s) it's changing; the server reads each row's
   current metadata to fill in the rest. The alternative (client fetches
   full metadata per selected row before submitting) would mean N extra
   round trips before the batch even starts.
2. **No "select all matching the current filter"** — only explicitly
   checked rows are editable. Selecting across a filter spanning more than
   what's loaded (paginated) would need a server-side by-filter bulk
   operation; not built for v1, flagged as a possible enhancement.

## Ticket 1.8 — Work queue screen

Spec: screens.md 5. STATUS.md row moved to `review`.

| Where | What |
|---|---|
| `apps/tax-receipts/api/src/work-items/list.ts` | `listWorkItems`, filtered by kind/status/ruleRef/assignee. Donor name comes from `WorkItem.contactId`, denormalized for exactly this (data-model §2), rather than joining through `subjectId` — that field is a loose string shared by four subject types, not a real foreign key. |
| `apps/tax-receipts/api/src/routes/work-items.ts` | `GET /work-items`, `POST /work-items/:id/resolve` (wraps 1.7's `resolveWorkItem` — generic across every WorkItem kind, so this ticket needed no new resolution logic, only the route). |
| `apps/tax-receipts/web/src/routes/work-queue.tsx` | The four tabs (validation, diff, owed-to-EO, sync incidents) as a button group, not Mantine's `Tabs` — sidesteps the Floating-UI/jsdom issue documented under 1.3 rather than risking hitting it again. Each row: subject (links to the 1.5 detail screen), donor, rule, opened/due dates, status, and inline resolve/except actions (a reason/note input appears in place, confirm disabled until 3+ characters). |

Tests: `list.test.ts` (kind/status/ruleRef filters, donor name join,
pagination), `routes/work-items.test.ts` (auth, list, resolve, rejects a
second resolve on an already-closed item), `work-queue.test.tsx` (renders
the default tab's items, switching tabs re-queries by kind, resolving
requires a note and posts the right outcome). `pnpm turbo run lint
typecheck test build` green, 20/20 tasks, 112 api tests + 12 web tests.

### Deviations / judgment calls

1. **No grouping by rule in the UI** — screens.md says "validation findings
   (grouped by rule)"; the API sorts by `ruleRef` so same-rule rows are
   adjacent, but the table doesn't render rule-group headers. A visual
   grouping pass is easy to add later without an API change.
2. **DIFF/OWED_TO_EO/SYNC_INCIDENT tabs are wired but will show empty**
   today — nothing in Phase 1 creates OWED_TO_EO items (Phase 2), and DIFF/
   SYNC_INCIDENT only populate once 1.1's sweep actually detects a Qomon-side
   change or deletion against real data.

## Ticket 1.9 — SpaceState ladder + state-machine tests

Spec: data-model.md §2 SpaceState, workflows.md W6/W7. STATUS.md row moved
to `review`; traceability.md gap 4 (I3) marked test-half-closed (the screen
half is ticket 1.10).

| Where | What |
|---|---|
| `packages/tax-receipts-core/src/space/state-machine.ts` | Pure ladder logic: `SPACE_STAGE_ORDER` (the seven W6 stages), `classifyTransition`/`assertValidTransition`. Deliberately just the ladder's *shape and direction* — a same-stage move is a no-op, any forward move is allowed (including skipping stages, e.g. a backfilled/pilot space jumping straight to "reported"), any backward move must pass `allowRegress` explicitly. The real preconditions for a given move ("queue actually empty," "issuance actually happened") belong to the tickets that trigger it, not this one. |
| `apps/tax-receipts/api/src/space/space-state.ts` | `getOrCreateSpaceState` / `moveSpaceStage`, persisting into `SpaceState` (`@@unique([periodId, ridingNumber, entityKind])`). A forward move or no-op is a plain write; a regression requires a `reason` and change-logs it (`SpaceState` isn't one of invariant 5's guarded tables, so this isn't DB-enforced — done anyway, since an unusual backward move is exactly the kind of thing W7's audit trail cares about). |

**Prisma gotcha worth flagging for later tickets touching `SpaceState`**:
its compound unique index includes the nullable `ridingNumber` (party-level
spaces), and Prisma's generated compound-unique `where` input requires
`ridingNumber: number`, not `number | null`, so `upsert`/`findUnique` on
that index can't express the null case. `getOrCreateSpaceState` uses
`findFirst` (which does accept `null` in a plain filter) plus a fallback
`create` instead — not perfectly race-free, judged acceptable for v1 given
nothing else writes this table yet.

Tests: `state-machine.test.ts` (stage order, no-op/advance/regress
classification, skip-ahead allowed, regression blocked without
`allowRegress`, unknown-stage error); `space-state.test.ts` (create-once
idempotency including the party-level/null-riding case, forward move with a
skip, regression rejected and the row left untouched, regression requires
and change-logs a reason, a no-op move can still update `stageOwner`).
`pnpm turbo run lint typecheck test build` green, 20/20 tasks, 81 core
tests + 63 api tests.
