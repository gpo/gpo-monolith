# Phase 3 — reviewer notes

Branch: `tax-receipts/phase-1` (Phase 3 work started ahead of Phase 1 landing,
by request — Phase 1 is otherwise unaffected). Same running-notes pattern as
[`PHASE-1-NOTES.md`](PHASE-1-NOTES.md).

## Ticket 3.1 — Individual receipt issuance

The first slice of receipting: one contribution -> one issued receipt, with
its PDF. Everything else Phase 3 implies (corrections/reissue, RTD filings,
entity reports, EO forms, consolidated multi-contribution receipts) is still
open.

| Where | What |
|---|---|
| `apps/tax-receipts/api/src/receipts/issue.ts` | `issueReceipt(deps, input)`. Checks the kill switch (`assertIssuanceEnabled`), loads the contribution + its metadata + contact, checks invariant 1 via `remainingEligibleCents` (`tax-receipts-core`), builds an `AddressSnapshot` from the contact's cached Qomon address, reserves the next `GPO-` sequence number, and writes `Receipt` + `ReceiptAllocation` in one `withChangeLog` transaction — same shape as `test/db.ts`'s existing `issueReceipt` fixture helper. Renders the PDF and links `pdfArtifactId` in a second change-logged update sharing the first write's `correlationId`. |
| `apps/tax-receipts/api/src/receipts/pdf.ts` | `renderReceiptPdf`: draws onto `assets/receipt-template.pdf` (copied from `scripts/generate_tax_receipt_pdfs/template.pdf`) using the same triplicate layout (office / donor / political-entity copies) as the legacy batch tool, so a tool-issued receipt matches what's already on file with EO. |
| `apps/tax-receipts/api/src/artifacts/store.ts` | `storeArtifact`: content-addressed (sha256) local-disk write + `Artifact` row. Stand-in for real object storage (no such ticket exists yet); `Artifact.uri` stays a storage-agnostic relative path so the swap needs no schema change. Directory from `ARTIFACT_STORAGE_DIR` (`env.ts`, default `./storage/artifacts`, gitignored). |
| `apps/tax-receipts/api/src/routes/receipts.ts` | `POST /contributions/:id/receipts` (CASL `issue Receipt` — party CFO or a CFO designate only, s. 25.1(6); sysadmin's `manage: all` deliberately does not cover this) and `GET /receipts/:id/pdf`. |
| `apps/tax-receipts/api/src/app.ts` | Registers `receiptRoutes`; maps `AllocationOverageError` (409), `ReceiptIssuanceValidationError` (400), `MissingAddressError` (422) alongside the existing `IssuanceDisabledError` (423) handling. |

Tests: `src/receipts/issue.test.ts` (happy path incl. PDF page count and
sequence/change-log side effects; kill switch; invariant-1 overage on one
shot and across two receipts against the same contribution; missing address;
unknown contribution; missing metadata), `src/routes/receipts.test.ts`
(auth, CASL 403 for administrator, happy path incl. PDF fetch, kill-switch
423). `pnpm turbo run lint typecheck test build` green.

### Deviations / judgment calls

1. **One contribution per receipt, this pass.** `ReceiptAllocation` is
   many-to-many by design (a receipt schema note reads "no `total` column -
   always derived from its allocations"), so consolidating several
   contributions onto one receipt is real and eventually needed. It's out of
   scope here: it raises questions this ticket has no basis to answer (whose
   accepted date prints? whose non-deductible amount governs a shared
   receipt?) that belong with the correction/consolidation workflow.
2. **`politicalEntityLabel` is a caller-supplied input, not derived.** The
   exact EO-facing wording for a CA/campaign/party "received by" line is a
   compliance.md question (private repo); guessing at legally-reviewed text
   felt like the wrong kind of shortcut. Whatever screen calls this route
   next should source the label from wherever that wording actually lives
   (an admin-configured per-entity name looks like the right shape, but that
   admin surface doesn't exist yet either).
3. **Address source is `Contact.addresses[0]` (the Qomon-synced address),
   not a donor-confirmed one.** `DonorCyclePreference.addressConfirmedAt`
   exists in the schema but nothing populates or checks it yet (no
   donor-precheck flow built). Rule B1 (out-of-province eligibility) is
   still unchecked, same open gap Phase 1 flagged (O34) — this only checks
   that *an* address exists, not that it's confirmed or in-province.
4. **Artifact storage is local disk**, gitignored under
   `apps/tax-receipts/api/storage/` by default. Fine for dev/test; a real
   deployment needs an actual object-storage ticket before this goes live,
   given the 6-year retention requirement on `Artifact` rows.
5. **No web UI.** This is API + PDF only, per the scoping conversation that
   started this ticket — the contribution-detail screen's "Allocations/
   receipts" panel is still the documented empty state until a UI ticket
   wires it to this route.

## Ticket 3.12 — Per-space issuance (first slice)

Screen 6's gate check + pre-issuance preview + generate, for one space
(period, riding, entity kind) at a time. Delivery (email/print, Qomon
activity logging, tickets 3.5/3.6) and the donor pre-check (3.9) are still
open — same gap 3.1 already left, just at space scale now.

| Where | What |
|---|---|
| `apps/tax-receipts/api/src/space/issuance.ts` | `getSpaceIssuanceGate` (any OPEN work item on a contribution in the space blocks the whole space — recomputed live, since `state-machine.ts` enforces no gates of its own), `previewSpaceIssuance` (gate + exactly what would issue, replacing trial receipts per O12), `issueReceiptsForSpace` (loops `issueReceipt` per still-eligible contribution; all-or-nothing on the gate, per-row-tolerant on issuance failures, same shape as ticket 1.4's bulk edit). |
| `apps/tax-receipts/api/src/routes/spaces.ts` | `GET /spaces/:periodId/:entityKind/issuance-preview` (any authenticated user, riding-scoped) and `POST /spaces/:periodId/:entityKind/receipts` (CASL `issue Receipt`, ridingNumber as a query param since it's optional — party-level spaces have none). |
| `apps/tax-receipts/web/src/routes/space-issuance.tsx` | The wizard itself: a Mantine `Stepper` with Review (blockers or preview totals/lines) → Generate (label, delivery override, mandatory reason) → Done (per-row results with PDF links). Reachable from a new "Issue" button on each space-dashboard row (`dashboard.tsx`). |

Tests: `space/issuance.test.ts` (gate, preview, generate, stragglers,
partial-failure tolerance), route tests appended to `routes/spaces.test.ts`
(auth, CASL 403, riding scope 403, 409 on a dirty gate), and a web test
(`routes/space-issuance.test.tsx`) covering the blocked state, the clear
preview, and a full generate round-trip. `pnpm turbo run lint typecheck
test build` green (api and web).

### Deviations / judgment calls

1. **Whole-space gate, not per-contribution.** One open work item anywhere
   in the space blocks issuance for everyone in it, not just its own
   contribution — matches the W6 ladder's "queue-clear" being a
   precondition for the whole space, not a per-row state.
2. **`politicalEntityLabel` is one value per space call**, not per
   contribution like 3.1. A space is exactly one entity/riding, so this is
   a small win over 3.1's awkward per-contribution input — still caller-
   supplied, same open compliance-wording gap.
3. **No delivery actually happens.** A generated receipt gets a delivery
   value (the donor's `DonorCyclePreference`, an override, or MAIL) stored
   on the row, but nothing is emailed or queued for print — that's tickets
   3.5/3.6, still open.
4. **The wizard is a single page, not a guarded multi-page flow.** Screens.md
   describes gate → preview → generate → deliver → done; without a deliver
   step to build yet, three `Stepper` steps (Review, Generate, Done) cover
   what exists without inventing UI for work that isn't there.

### Fixture data for manual testing

`apps/tax-receipts/api/prisma/seed-fixtures.ts` (`pnpm db:seed:fixtures`;
consolidated 2026-09-22 — see that ticket's own notes below) seeds five
spaces — clean, blocked, partial-failure-on-generate, and a donor spanning
three spaces across different periods/ridings/entities — to exercise the
wizard above without hand-entering data per session. See
[`PHASE-3-MANUAL-TEST-PLAN.md`](PHASE-3-MANUAL-TEST-PLAN.md) §1 for what
each seeded donor demonstrates. One thing this surfaced worth flagging: a
"clean" PARTY-level space can't be guaranteed on a dev database that's seen
any real use, since every PARTY-level fixture and every real Qomon-mirrored
contribution shares that one space — the fixture's "ready to issue" case
needed its own reserved, date-isolated period (9502 as of the 2026-09-22
renumbering) to actually stay clean.

## Ticket 3.2 — Allocation model

Guarantee G1's invariant-1 machinery (Σ issued allocations ≤ eligible amount)
already existed before this ticket: the DB triggers shipped with 0.3
(`prisma/migrations/20260910120100_invariants_1_5`) and the pure
`checkAllocationSum`/`remainingEligibleCents`/`receiptTotalCents` functions
plus their property-based test (`tax-receipts-core/src/invariants/
allocation.test.ts`) shipped alongside it, reused as-is by 3.1's
`issueReceipt`. What 3.1 and 3.12 never did is exercise `ReceiptAllocation`
as actually many-to-many: every receipt issued so far still has exactly one
allocation.

| Where | What |
|---|---|
| `apps/tax-receipts/api/src/receipts/allocate.ts` | `allocateToReceipt(deps, input)`: attaches one more contribution's allocation to an existing, still-`ISSUED` receipt. Re-checks invariant 1 for that contribution via `remainingEligibleCents` (the exact same check `issueReceipt` runs), requires the contribution's contact to match the receipt's contact, and rejects a duplicate contribution on the same receipt (the schema's `@@unique([receiptId, contributionId])` is the backstop; the service checks first for a clean error). |
| `apps/tax-receipts/api/src/routes/receipts.ts` | `POST /receipts/:id/allocations`, gated on CASL `correct Receipt` (not `issue`) — attaching a contribution to an already-issued receipt reads as a correction to existing money, not the act of originating a new receipt, so it follows the broader `correct` grant (party CFO, CFO designates, and administrators) rather than `issue`'s CFO-only one. |
| `apps/tax-receipts/api/src/app.ts` | Maps the three new error classes: `ReceiptNotFoundError` (404), `TerminalReceiptError` and `DuplicateAllocationError` (409), `AllocationContactMismatchError` (400). Reuses 3.1's `AllocationOverageError` (409) and `ReceiptIssuanceValidationError` (400) as-is. |

Tests: `src/receipts/allocate.test.ts` (happy path with total recomputation,
invariant-1 overage and exact-fit, terminal receipt, contact mismatch,
duplicate allocation, unknown receipt/contribution, missing metadata), route
tests appended to `src/routes/receipts.test.ts` (auth, 403 for a role with no
`correct` grant, an administrator succeeding where 3.1's issue route would
403 them, 409 on a duplicate). `pnpm turbo run lint typecheck test build`
green.

### Deviations / judgment calls

1. **Deliberately does not decide which contribution's `acceptedAt` or
   `goodsServices` prints, and does not re-render the PDF.** This is the same
   question 3.1's header comment already declined to guess at, now real
   instead of hypothetical: `reports/load-receipts.ts`'s
   `MultiAllocationReceiptError` — built in 4.1 as a *forward* guard on the
   assumption no multi-allocation receipt could exist yet — is now a live
   gap. Its doc comment is updated to say so. Nothing calls
   `allocateToReceipt` today (no earlier ticket has a reason to), so no
   report run hits it yet, but the first correction ticket that does (3.10 or
   3.11) needs to resolve both questions before consolidated receipts can be
   reported, or `load-receipts.ts` needs its own follow-up to handle them.
   Flagged rather than guessed at, per 3.1's own precedent.
2. **`correct`, not `issue`, gates the route.** `abilities.ts` already
   defines `correct` as "run a correction action" and grants it to
   administrators (who cannot `issue`); adding an allocation to existing
   money fits that action better than fresh issuance. This does mean an
   administrator — not just the CFO or a designate — can grow an issued
   receipt's total, which is a real authority question worth confirming
   before 3.10 builds real correction actions on top of this primitive.
3. **No new PDF, no change to the existing one.** The already-rendered PDF
   for the receipt's original allocation is untouched; a receipt whose total
   grew via this route will show a stale total on its stored PDF until
   whatever regenerates it (again, 3.10/3.11's job — those tickets already
   have `Receipt.reissuedFromId`/`replacedById` for exactly this).
4. **No web UI**, same as 3.1: this is a service function plus one route,
   with no screen calling it. `screens.md`'s correction-actions screen
   (screen 8, ticket 3.14) is the natural future caller.

## Fixture consolidation (2026-09-22, not a ticket)

Prompted by a real Elections Ontario riding-directory import
(`ontario-ridings.json`, 124 rows, now loaded by `prisma/seed.ts`) exposing
that the Phase 2 and 3 fixture scripts had each invented their own "fixture"
riding numbers (12, 84, 90) without knowing a real directory would ever
exist — 84 and 90 turned out to be real ridings (Parry Sound—Muskoka, St.
Catharines) wearing fake fixture names ("York-Simcoe," "Simcoe North"). Left
alone, whichever seed step ran first on a given database would win, silently
mislabeling a real riding or making the "defunct riding" fixture into a
real, active one depending on order.

Fixed by merging `seed-phase-2-fixtures.ts` and `seed-phase-3-fixtures.ts`
into one script, `prisma/seed-fixtures.ts` (single command,
`pnpm db:seed:fixtures`). First attempt moved every fixture riding onto
numbers 9001-9003, outside the real 1-124 range the admin import route's own
Zod schema documents (`RidingImportRow`, `routes/admin.ts`) — reverted after
actually running it: rule A2 (`checkA2RidingEntityConsistency`) validates
`ridingNumber` against 1-124 as its own shape check, independent of whether
a `Riding` row exists, so an out-of-range number doesn't dodge the collision
problem, it just produces a different wrong finding (three Group 1 donors
that should have read clean or `A3` read `A2` instead — caught by diffing
against `PHASE-2-MANUAL-TEST-PLAN.md`'s expected-findings table). Landed
instead on borrowing real riding numbers that match what the original
fixture names were already trying to say — 121 (York—Simcoe) and 100
(Simcoe North) used as ordinary active ridings, and 12 (Brampton West)
forced inactive by the script itself for the one fixture that genuinely
needs a defunct riding (restored by the next `pnpm db:seed` run). No fixture
can still be mistaken for unrelated real riding config, which was the actual
goal; there was just no out-of-range shortcut to it. Also added: a new
fixture group (910001-910002, "Consolidating Chris")
exercising ticket 3.2's `allocateToReceipt` for the first time outside its
own unit tests, and an RTD-flow walkthrough section in
`PHASE-2-MANUAL-TEST-PLAN.md` §2 reusing the existing "Threshold Crossing
Donor" rows to manually exercise draft/stamp/archive/DC-1A/the filings
screen (tickets 2.2-2.8), none of which had a manual-test section yet
despite shipping. See `seed-fixtures.ts`'s header comment for the full
reserved-id table.

## Ticket 3.3 — Receipt immutability (invariant 7)

Data-model.md §2 states invariant 7 narrowly ("an AddressSnapshot referenced
by an ISSUED receipt is immutable"); the backlog line for this ticket
("Receipt immutability") and corrections.md's own principle 1 ("a receipt
record, once generated, never changes; corrections produce new records")
both read broader, so this ticket enforces both: the literal AddressSnapshot
clause, and the rest of `Receipt`'s own core fields, which invariant 3
(ticket 0.3) only ever covered for `receiptNumber`.

| Where | What |
|---|---|
| `prisma/migrations/20260922150000_invariant_7_receipt_immutability` | Two new trigger sets. `address_snapshot`: any `UPDATE` or `DELETE` on a snapshot referenced by any `receipt` row is refused (closes a real gap too — ticket 0.3's invariant-4 hard-delete list never covered `address_snapshot` at all). `receipt`: `numberSource`, `ridingNumber`, `entityKind`, `periodId`, `issueDate`, `contactId`, `contactNameSnapshot`, `addressSnapshotId`, `reissuedFromId` are frozen after the INSERT; `status` may only move `ISSUED -> CANCELLED`/`VOID` (terminal after); `lost` is one-way `false -> true`; `replacedById` and `pdfArtifactId` are each one-time `NULL -> value`; `delivery`/`deliveredAt` are left unconstrained (delivery logistics, not a receipt fact — tickets 3.5/3.6 haven't specified their lifecycle yet). |
| `apps/tax-receipts/api/src/invariants/receipt-immutability.test.ts` | One test per clause above, using raw `$executeRaw` for the illegal-mutation cases (same style `db-invariants.test.ts` uses for invariant 4) and `withChangeLog` for the legitimate one-time transitions. |

Nothing in the existing service layer needed to change: `issueReceipt` (3.1)
already only ever does the one legitimate `pdfArtifactId` NULL->value write,
`allocateToReceipt` (3.2) never touches the `receipt` row at all, and the
one existing test that cancels a receipt (`db-invariants.test.ts`) already
only performs the one allowed `ISSUED -> CANCELLED` transition — confirmed
by the full suite passing unchanged against the new triggers before adding
this ticket's own tests.

### Deviations / judgment calls

1. **`lost` is one-way.** Nothing in corrections.md describes an "un-lose"
   action, so `true -> false` is rejected rather than left open. If ticket
   3.11 (Lost status, "Copy" reprint) turns out to need this, it's a
   one-line trigger change, not a design problem.
2. **`delivery`/`deliveredAt` are deliberately unconstrained.** They're
   logistics (which channel, whether it went out), not one of the "receipt
   facts" invariant 7 and corrections.md principle 1 are protecting.
   Tickets 3.5/3.6 haven't shipped, so guessing at their exact mutation
   pattern felt like the wrong kind of shortcut — same call 3.1/3.2 already
   made for other still-open questions.
3. **`pdfArtifactId` frozen forever, including for future reprints.**
   Ticket 3.11's "Copy" reprint will need to render a *new* PDF for an
   already-issued receipt; this migration means it cannot store that back
   onto the same receipt's `pdfArtifactId`. That's intentional given
   corrections.md's "a receipt record, once generated, never changes," but
   it does mean 3.11 needs its own place to put a reprint's artifact (a new
   `EOForm` row, or a new field/table) — flagged here rather than solved,
   since 3.11 isn't built yet and guessing at its shape now would be the
   same mistake ticket 3.1 avoided with `politicalEntityLabel`.
