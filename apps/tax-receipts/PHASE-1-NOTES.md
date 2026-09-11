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
