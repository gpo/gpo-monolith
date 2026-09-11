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

## Ticket 1.2 — not yet started as of this note.
