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

## Ticket 3.4 — PDF rendering + text-extraction tests (F4)

test-plan.md's F4 asks for two things: render a sample of receipts and
extract text fields (number, dates, amount, name, address, entity, the
official-receipt statement) back out, **and** compare those against real,
EO-issued 2025 receipt PDFs. Only the first half is buildable here — the
real 2025 receipt PDFs are private, PII-bearing Drive downloads with no
fetch access from this build environment (`research/fixtures/README.md`),
the same class of gap as 4.1/4.2's F1 byte-diff residual and O43's DC-1A
template. `renderReceiptPdf` (ticket 3.1) had no dedicated test file before
this — `issue.test.ts` only ever checked page count, never what the PDF
actually says.

| Where | What |
|---|---|
| `apps/tax-receipts/api/src/receipts/pdf.test.ts` | Renders a receipt with known data, extracts the text back out with `pdf-parse` (new devDependency — pure-JS/TypeScript, no system binary, so it runs the same in CI as locally), and asserts every F4 field is present, on all three of the template's stamped copies, not just one. Also covers the goods-and-services contribution-type wording, the EO contributor id's presence/absence, and address-line-2/postal-code formatting. |

One thing worth recording since it wasn't obvious going in: the template's
"This is your Official Receipt for income tax purposes." statement (and the
GPO letterhead) turned out to already be real, extractable text embedded in
`assets/receipt-template.pdf` itself (confirmed with `pdftotext` directly
against the template before writing any test) — `pdf.ts` never draws that
line itself, it just copies the template page and draws the dynamic fields
on top. The open question going in was whether `pdf-lib`'s `copyPages` plus
the dynamically-drawn `Helvetica` text would still leave that embedded
statement extractable in the *final* rendered receipt, not just the raw
template — confirmed yes, on the first real run, no code changes needed.

### Deviations / judgment calls

1. **`pdf-parse` added as a devDependency, not a runtime one.** F4 is a
   test-plan requirement, not a feature the app itself needs — nothing in
   `src/` outside this test file extracts text from a PDF. Picked over
   shelling out to a system `pdftotext` binary (used only to manually probe
   the template while writing this ticket, never from checked-in code)
   specifically so CI doesn't need a system dependency to run these tests.
2. **No golden comparison against real 2025 PDFs.** Flagged above rather
   than worked around; whoever gets Drive access can extend this file with
   real fixtures the same way 4.1/4.2's byte-diff residual is waiting on it.

## Ticket 3.5 — Delivery: email (read-only formats), consolidated print, Qomon activity logging

Story I2 (PRD.md): "delivery is by email or into one consolidated print PDF
per run, honouring donor preference; every send is recorded as a Qomon
activity on the donor." screens.md screen 6 places this as its own wizard
step after generate: "generate → deliver (email batch + consolidated print
PDF; Qomon activities logged) → done." Two of those three clauses are
buildable; the third — logging to Qomon — turned out not to be, researched
properly rather than faked (see open-questions.md **O45**, new).

| Where | What |
|---|---|
| `apps/tax-receipts/api/src/receipts/delivery.ts` | `deliverSpaceReceipts(deps, input)`: takes the exact receipt ids a `issueReceiptsForSpace` (3.12) call just returned (not "every undelivered receipt in the space" — see deviation 1), splits them by `Receipt.delivery`. EMAIL receipts each get a rendered cover-letter PDF (`renderCoverLetterPdf`, a plain new one-page letter — no legacy template exists for this, unlike the receipt itself). MAIL receipts get merged into one consolidated print PDF (`mergeReceiptPdfs`, `pdf-lib` page concatenation in receipt-number order) for the mailhouse to print and stuff as one run. Every processed receipt gets a `ChangeLogEntry` recording which channel and which artifact(s) — the tool's own interim answer to "every send is recorded," since no Qomon-side equivalent exists (O45). |
| `apps/tax-receipts/api/src/routes/spaces.ts` | `POST /spaces/:periodId/:entityKind/deliver`, gated on CASL `issue Receipt` (same authority as generate — screens.md: "issuance itself executes under the CFO authority model"), taking `{ receiptIds, reason, coverLetterBody }`. |

Tests: `src/receipts/delivery.test.ts` (email/mail split with real
text-extraction on both the cover letter and the merged PDF via ticket
3.4's new `pdf-parse` dependency, multi-page merge order, and all four error
paths: unknown receipt, wrong space, non-`ISSUED` receipt, missing PDF).
`pnpm turbo run lint typecheck test build` green (268 tests).

### Deviations / judgment calls

1. **Explicit `receiptIds` input, not "every undelivered receipt in the
   space."** This ticket deliberately never sets `Receipt.deliveredAt` (see
   below), so there's no DB flag that would make a "what still needs
   delivering" query safe to call twice. Taking the exact ids the caller
   just generated makes double-delivery a caller error, not a silent
   re-send — the same shape `issueReceiptsForSpace` already uses for its own
   idempotency story (repeatable for stragglers, not repeatable for the same
   batch).
2. **`Receipt.deliveredAt` is untouched.** Ticket 3.6's backlog line pairs
   it with "provider message id and status stored alongside `delivered_at`"
   — read together, that column means *confirmed sent by a real provider*,
   which nothing in this ticket can confirm (no live email send, no real
   mailhouse handoff yet). Setting it here would be a well-intentioned
   fabrication of the one thing 3.6 actually verifies. Invariant 7 (ticket
   3.3) already left `delivery`/`deliveredAt` unconstrained anticipating
   exactly this kind of open lifecycle question.
3. **No Qomon activity is created (O45).** Researched, not assumed:
   `research/qomon-api-reference.md`'s own gap analysis (#6, #12, #14)
   concludes there is no activity/timeline/document facility in any of the
   five Qomon specs, and the closest primitive (`Contact.notes`) is unsafe
   to append to programmatically given `Contact` `PATCH`'s documented
   full-replace, data-loss-risk semantics. The tool's own `ChangeLogEntry`
   carries the delivery record instead.
4. **`coverLetterBody` is a caller-supplied input, not derived or
   templated.** workflows.md: "the cover letter is a template editable by
   the rules authority" — no admin screen or storage for that template
   exists yet (ticket 1.12 didn't include it), and no placeholder syntax is
   specified anywhere, so this takes the fully-composed text as one value
   per call, same pattern as 3.12's `politicalEntityLabel`. A real template
   system with per-donor interpolation is future work, not guessed at here.
5. **No web UI.** Same gap every Phase 3 ticket so far has left: this is a
   service function plus one route. The wizard's "deliver" step (screens.md
   screen 6) still needs its own UI work once this and 3.6 both exist.

## Ticket 3.8 — Foreign / EO-stock / manual receipt numbers

Ticket 3.6 (delivery infrastructure: a real email provider on a warmed
subdomain) is genuinely blocked — no provider or domain exists yet, and
there's no code-only slice of "warm a subdomain." Skipped ahead to 3.8
rather than force it. 3.7 (booking the print/mailhouse path with Ariel) is
a human coordination task, not a build ticket, so it's not tracked here
either.

data-model.md §2: "receipt_number tolerates foreign numbers (EO-stock or
manual receipts issued outside the tool) with a source flag." compliance.md/
rollout.md are explicit this is meant to be rare going forward ("No paper or
EO-stock receipting" is the stated 2026 policy) — this ticket is for the
exception (an event with no connectivity, a handwritten slip) and for
ticket 5.1's legacy import, not a parallel everyday issuance path.

| Where | What |
|---|---|
| `apps/tax-receipts/api/src/receipts/foreign.ts` | `recordForeignReceipt(deps, input)`: same invariant-1/kill-switch/address-snapshot/change-log shape as `issueReceipt` (3.1), but takes the operator-supplied `receiptNumber` directly instead of reserving one from `ReceiptSequence` — invariant 3's DB trigger already exempts `numberSource: FOREIGN` rows from the sequence check entirely (built with 0.3, never previously exercised by a real code path). Rejects a number that matches the tool's own `GPO-\d+` format (almost certainly an operator mistake, not a real foreign number) and a number that's already recorded. |
| `apps/tax-receipts/api/src/routes/receipts.ts` | `POST /contributions/:id/receipts/foreign`, same CASL `issue Receipt` gate as individual issuance (still money-relevant, still CFO-authority). |

Tests: `src/receipts/foreign.test.ts` (happy path incl. no PDF and an
untouched sequence counter, the two number-format guards, invariant-1
overage, kill switch, missing address, unknown contribution, missing
metadata, an explicit past `issueDate`), route tests appended to
`routes/receipts.test.ts` (happy path with a 404 PDF fetch, CASL 403,
sequence-format 400). `pnpm turbo run lint typecheck test build` green.

### Deviations / judgment calls

1. **No PDF is ever rendered for a foreign receipt.** The physical
   instrument (the pre-printed EO-stock slip, the handwritten receipt)
   already exists and *is* the legal document; the tool has no template for
   an arbitrary foreign number format, and fabricating one would misrepresent
   what was actually handed to the donor. `Receipt.pdfArtifactId` stays
   permanently `null` — invariant 7 (ticket 3.3) already treats "never set"
   as a valid terminal state, not just "not yet set," so this needed no
   trigger change.
2. **The kill switch still applies.** A foreign receipt is being *recorded*,
   not newly issued in the moment, so there's a case for treating it as
   exempt — but recording one still increases the year's receipted-contribution
   count under GPO's name, which is exactly what the statutory kill switch
   exists to stop. Applied the same guard as `issueReceipt` rather than
   carving out an exception nothing in compliance.md asks for.
3. **The `GPO-\d+` format guard is a new, tool-invented safety check**, not
   something data-model.md specifies. Added because a real foreign/EO-stock/
   manual number looks nothing like the tool's own sequence output, so a
   match is far more likely an operator error (meant to look up a real
   issued receipt, typed the wrong endpoint) than a genuine foreign receipt.

## Ticket 3.9 — Donor pre-check (V4)

PRD.md story V4: "before issuance I receive a pre-check (tied to my email)
confirming my address and delivery preference." `DonorCyclePreference` has
existed since ticket 0.2, and `space/issuance.ts` (3.12) already reads its
`delivery` column when resolving a receipt's channel — but nothing before
this ticket ever wrote `precheckSentAt` or `addressConfirmedAt`. Closes
traceability.md gap 2 ("pre-check send/response state has no test").

Split the same way ticket 3.5's delivery is split from 3.6's real send:
sending is a staff action that stamps state and hands back a confirmation
token; nothing here emails that token to anyone, since no provider/warmed
subdomain exists yet (O24, the same gap 3.6 itself is blocked on). The
donor-facing confirm half is real and complete — it's specifically the
"put this in an actual email" step that's missing, matching 3.5's own
scope line.

| Where | What |
|---|---|
| `prisma/migrations/20260923140000_donor_precheck_token` | Adds `confirmationToken` (unique), `confirmationTokenExpiresAt`, and `confirmationPeriodId` to `donor_cycle_preference`. Purely additive; no invariant trigger changes. |
| `apps/tax-receipts/api/src/donors/precheck.ts` | `sendDonorPrechecksForSpace(prisma, input)`: for every contact behind a still-eligible (`remainingEligibleCents` > 0) contribution in a space, upserts that donor's `DonorCyclePreference` for the period's year with a fresh bearer token and `precheckSentAt`; a donor with no email on file is skipped, not failed. `confirmDonorPrecheck(prisma, input)`: the unauthenticated, token-only half — looks the row up by token, rejects an unknown or expired one, writes a new `AddressSnapshot` (source `donor-precheck`, a value that field's own schema comment already anticipated back in ticket 0.2) under the space's period, and atomically clears the token via a guarded `updateMany` so a replayed link can't re-confirm. |
| `apps/tax-receipts/api/src/routes/spaces.ts` | `POST /spaces/:periodId/:entityKind/precheck`, gated on CASL `update ContributionMetadata` (the one action party_cfo, administrator, and rules_authority all already share — no new CASL action invented for this). Returns each sent token in the response body, since there's no channel yet for it to travel any other way. |
| `apps/tax-receipts/api/src/routes/donor-precheck.ts` | `POST /donor-precheck/:token/confirm` — registered with no auth check at all, the one deliberately public route in the app. |

Tests: `src/donors/precheck.test.ts` (send: happy path + change-log entry,
skips a no-email donor, skips a fully-non-deductible contribution, defaults
to MAIL unconfirmed, re-sending rotates the token; confirm: happy path +
new AddressSnapshot, unknown token, expired token, already-used token,
old token invalidated by a re-send), route tests in `routes/spaces.test.ts`
(auth, CASL 403, happy path) and a new `routes/donor-precheck.test.ts`
(no-session confirm, unknown/expired/reused token, a validation 400).
`pnpm turbo run lint typecheck test build` green (299 tests).

### Deviations / judgment calls

1. **No email is ever sent.** Same stance as 3.5/3.6: no provider or warmed
   subdomain exists (O24), so this stops at "here is a token and an
   expiry," returned to the staff caller who triggered the send. Once 3.6
   ships, wiring an actual send is additive — nothing here needs to change,
   the token/expiry shape it produces doesn't assume any particular
   delivery channel.
2. **A confirmed address becomes a new `AddressSnapshot`, never a write onto
   `Contact.addresses`.** The confirm route has no session and no CASL —
   letting an unauthenticated caller mutate the Qomon-synced contact cache
   would be a real integrity hole, and `AddressSnapshot.source`'s own doc
   comment (`"donor-precheck"`) already signals this was the intended shape
   from ticket 0.2 onward. A donor who reports a materially different
   address than what's on file in Qomon isn't reconciled anywhere yet — the
   snapshot exists and is real, but nothing diffs it against
   `Contact.addresses` or flags the mismatch for staff. Flagged, not solved:
   no rule or screen currently owns "the donor said X, Qomon says Y."
3. **Population is "every contact behind a still-eligible contribution in
   the space," independent of `getSpaceIssuanceGate`.** screens.md screen 6
   places the pre-check send "ahead of the window," before generate — gating
   it on the same validation-queue-empty condition that blocks generate
   would default to sending pre-checks too late to matter, since these are
   two different points in the wizard's timeline.
4. **The send route is gated on `update ContributionMetadata`**, not a new
   CASL action. No action in `abilities.ts` maps cleanly onto "send a
   pre-check" — it's not `issue` (nothing is issued), and it's not
   `correct` (nothing is being fixed). `update ContributionMetadata` is the
   one action party_cfo, administrator, and rules_authority already share
   and no one else does, which matches this being pre-issuance prep work
   rather than the issuance act itself.
5. **The confirmation token is single-use**, cleared via a guarded
   `updateMany` matched on the token itself (not the row id) inside the same
   transaction that writes the `AddressSnapshot` — a concurrent replay of
   the same link finds zero rows to update and 404s, rather than racing to
   silently double-confirm.
6. **No web UI**, on both sides. The pre-check send button belongs on the
   issuance wizard's screens.md screen 6 (not built here — 3.12 shipped
   Review/Generate/Done only); the donor-facing confirm form is a public,
   unauthenticated page with no precedent yet in `apps/tax-receipts/web/`.

### Follow-up (2026-09-23, not a new ticket): the web UI deviation 6 left open

Closed both halves of deviation 6 above, plus built the dev-only convenience
that makes the whole thing testable with no real email provider.

| Where | What |
|---|---|
| `apps/tax-receipts/web/src/routes/donor-precheck.tsx` | The public confirm page: address form + EMAIL/MAIL choice, and friendly states for an already-used or expired link. |
| `apps/tax-receipts/web/src/router.tsx` | `RootLayout` now special-cases any `/donor-precheck/*` path: skips the `/auth/me` fetch entirely and renders the route with no `AppShell` chrome, so a donor with no session never falls into the "not logged in -> show the login form" branch every other path hits. |
| `apps/tax-receipts/web/src/routes/space-issuance.tsx` | The Review step gained a "Donor pre-check" card — reason field, "Send pre-checks" button, sent/skipped summary — rather than its own `Stepper.Step`; see deviation 7 below. |
| `apps/tax-receipts/api/src/donors/precheck.ts`, `routes/admin.ts` | New `listOutstandingDonorPrechecks` / `GET /admin/donor-prechecks`: every unconfirmed, unexpired token, sysadmin-only (a token is a bearer credential over a donor's own preference row, so this doesn't get the same "any authenticated read" treatment the rest of `routes/admin.ts` uses). |
| `apps/tax-receipts/web/src/routes/dev-tools.tsx` | "Donor pre-check outbox" card: lists what the endpoint above returns, each with an "Open confirm page ↗" link — click one exactly as a donor would click the link in an email, since no real one exists yet (ticket 3.6, O24). |
| `apps/tax-receipts/api/src/routes/session.ts` | `/auth/me`'s `can` now includes `sendDonorPrechecks` (`update ContributionMetadata`), so the wizard button gates itself the same way every other action-gated button in the app does. |

Tests: `precheck.test.ts`'s existing suite covers the service; new coverage
added at every other layer touched — `routes/admin.test.ts` (outbox: 401,
403 for a non-sysadmin, 200 for a sysadmin), `routes/space-issuance.test.tsx`
(send button, reason validation, sent/skipped summary), and a new
`routes/donor-precheck.test.tsx` (renders with no session and never calls
`/auth/me`, happy path, 404, 410). `pnpm turbo run lint typecheck test build`
green (300 api tests, 40 web tests). Manually verified end to end against
the running dev server too: logged in as the seeded administrator, sent a
pre-check against a real fixture space, confirmed the one donor with an
email got a token while the other three were correctly skipped, confirmed
through the public endpoint, and confirmed a replayed token 404s.

### Deviations / judgment calls (follow-up)

7. **The pre-check send action is a card inside the existing Review step,
   not its own `Stepper.Step`.** screens.md's screen 6 prose reads as a
   five-step flow (gate → preview → generate → deliver → done) with the
   pre-check folded into "ahead of the window" — but delivery itself still
   has no wizard step either (ticket 3.5's API exists, 3.6's real send
   doesn't), so adding a dedicated pre-check step while deliver still has
   none would overstate how much of the flow is actually wired up.
8. **The outbox endpoint is a permanent, always-available part of
   `routes/admin.ts`**, not something torn out once ticket 3.6 ships a real
   provider, and it is not gated by `NODE_ENV` — same stance `dev-tools.tsx`
   itself already takes for the Qomon sweep trigger (the *page* is hidden
   outside dev builds via `import.meta.env.DEV`; the endpoint underneath is
   always live, sysadmin-only). Worth a second look once 3.6 exists: a
   sysadmin being able to read any donor's active confirmation token is a
   reasonable support tool, but it's a different risk profile in production
   than it is as a pure dev convenience.

## Ticket 3.10 — Correction actions: cancel / reissue (first slice)

corrections.md catalogues 11 correction actions. This ticket does not build
all of them in one pass — actions 1 (cancel) and 2 (reissue) are the
foundational primitives every other action composes from (a donor move, a
split, a refund are all "cancel this, issue that" at their core), and they
are also where corrections.md's own emphasis lands: "cascade preview first"
and "EO-awareness is automatic" only mean something once a cascade actually
exists. STATUS.md marks 3.10 `wip`, not `done`, the same honest-partial
stance ticket 3.12 took.

Built on real, already-shipped primitives rather than new machinery:
`remainingEligibleCents` (invariant 1) already excludes a non-`ISSUED`
receipt's allocations, so "releasing" them on cancel needed no schema change
or extra write at all; invariant 7's `replacedById`/`reissuedFromId` fields
(ticket 3.3) were built anticipating exactly this; the `OWED_TO_EO`
`WorkItemKind` (ticket 0.2) and `generateDc1aAmendment` (ticket 2.4) already
existed waiting for a real producer — ticket 2.8's own note called this out
by name ("the owed-to-EO queue, which nothing populates yet (ticket 3.10)").

| Where | What |
|---|---|
| `apps/tax-receipts/api/src/corrections/cancel.ts` | `previewReceiptCorrection` (the cascade preview: every allocated contribution, its amount, whether it's RTD-reported); `cancelReceipt` (action 1: flips `status` to `CANCELLED`, renders a watermarked cancellation-notice PDF when the original had one, opens one `OWED_TO_EO` `WorkItem` per RTD-reported allocated contribution); `reissueReceipt` (action 2: cancel, then issue one replacement covering every contribution the old receipt carried, re-deriving each amount fresh from `remainingEligibleCents` rather than copying the old allocation). |
| `apps/tax-receipts/api/src/corrections/cancellation-notice.ts` | `renderCancellationNoticePdf`: stamps "CANCELLED" diagonally across every page of the original receipt PDF (`pdf-lib`), the same treatment workflows.md's "Current" process already does by hand in Adobe. |
| `apps/tax-receipts/api/src/routes/receipts.ts` | `GET /receipts/:id/correction-preview` (broad `read`), `POST /receipts/:id/cancel` and `POST /receipts/:id/reissue` (both `correct Receipt`, the same gate `allocateToReceipt`'s route already uses). |

Tests: `src/corrections/cancel.test.ts` (9 tests: cancel happy path incl.
watermark + re-issuability of the released allocation; unknown/already-
cancelled receipt; a foreign receipt with no PDF to watermark; the
OWED_TO_EO round trip proven against the *real* `generateDc1aAmendment`,
not a mock; single- and multi-allocation reissue; kill-switch on reissue but
not cancel; a stale address blocking reissue; a partially-allocated
contribution reissued for exactly what's left, unaffected by a second
receipt already covering the rest), route tests appended to
`routes/receipts.test.ts` (auth, CASL 403, preview/cancel/reissue happy
paths). `pnpm turbo run lint typecheck test build` green (314 tests).

### Deviations / judgment calls

1. **Only actions 1 and 2 are built.** Actions 3 (lightweight reprint) and
   11 (DC-1A) overlap with tickets 3.11 and 2.4 respectively — 3.11's own
   backlog line ("Lost status, 'Copy' reprint, cancellation notice, and
   'cancels and replaces receipt #' text") is explicitly the exact-wording/
   stamp-placement layer on top of what this ticket built the mechanism for,
   and 2.4 already built the DC-1A generator this ticket now feeds for
   real. Actions 4 (correct contribution amount), 5/6 (move contributions/
   receipt between donors), 7 (split), 8 (refund and cancel), 9 (guided B2
   reallocation), and 10 (merge duplicate contacts) are each a real,
   separate slice of work — donor-identity questions (5, 10), a UX-heavy
   guided flow (9), and a genuinely different receipt-splitting shape (7) —
   not attempted here. Each can now build on `cancelReceipt`/`reissueReceipt`
   rather than reimplementing the cascade.
2. **The Cancellation Notice IS the watermarked copy**, not two separate
   documents. corrections.md's action 1 reads as if there are two things (a
   rendered "Cancellation Notice" and a separately "queued" donor notice
   "with the cancelled copy") — no second document exists anywhere else in
   this tool's design (no cancellation-notice template, unlike the receipt
   itself), and workflows.md's "Current" process describes exactly one
   artifact (the watermarked original). Treating them as the same thing is
   the same kind of call ticket 3.5 made for the cover letter: build the one
   real artifact, don't invent a second one nothing specifies.
3. **`reissueReceipt` re-derives every contribution's amount fresh** rather
   than copying the old allocation's amount forward. This is what makes a
   multi-allocation reissue correct (and what actually resolves the "belongs
   with the correction/consolidation workflow" forward-reference
   `receipts/allocate.ts`'s header comment left for this ticket) — but it
   does NOT resolve O44 (which contribution's `acceptedAt`/`goodsServices`
   prints on the new PDF): the first-allocated contribution is used as a
   stand-in, same unresolved guess ticket 3.2 already declined to make, just
   now actually exercised by a real reissued PDF instead of a receipt
   nothing could report on. `reports/load-receipts.ts`'s
   `MultiAllocationReceiptError` guard is untouched and still blocks the
   ALL/S2P2 generators on any such receipt (O44 updated, not resolved).
4. **No kill-switch check on `cancelReceipt`.** Cancelling reduces the
   year's receipted count; the statutory freeze exists to stop new receipts
   from being issued, not to trap staff into being unable to fix a mistake
   during an EO-requested freeze. `reissueReceipt` mints a new sequence
   number, so it gets the same `assertIssuanceEnabled` check every other
   issuance path has.
5. **`OWED_TO_EO` `WorkItem.dueAt` is left `null`.** corrections.md says
   only "RTD amendments promptly" — no compliance.md or rollout.md source
   gives promptly a number of days, and inventing one felt like the wrong
   kind of shortcut on a real EO deadline. Flagged, not guessed at.
6. **No riding-scope check on the new routes**, matching
   `routes/receipts.ts`'s and `routes/contributions.ts`'s existing
   convention for single-resource-by-id routes: riding scoping happens at
   list-query level (`ridingScopeWhere`) so a scoped user never sees a
   receipt outside their grant to begin with; direct-by-id routes across
   this codebase don't re-check it (unlike the space-scoped routes in
   `routes/spaces.ts`, which take a riding as a query parameter and so have
   no row to load one from first).
7. **No donor communication is actually sent.** corrections.md: "each action
   queues the appropriate donor notice... delivered per donor preference,
   each send logged as a Qomon activity" — same two gaps tickets 3.5/3.6
   already carry (no Qomon activity facility exists at all, O45; no real
   email provider, O24) and ticket 3.6 is still blocked on. The cancellation
   notice artifact exists and is stored; nothing delivers it yet.
8. **No web UI.** Same gap every correction-adjacent ticket has left so far
   (3.2's allocation, 3.9's pre-check) — `routes/receipt-registry.tsx` and
   the guarded correction-actions modal are screens 7/8, tickets 3.13/3.14,
   not built yet.

## Tickets 3.10 (the rest), 3.11, and 3.14: the correction actions

Everything in corrections.md's catalogue is now built except the free-standing
"Retract from EO" screen (action 11 is `rtd/dc1a.ts`, fed by the owed-to-EO
items the actions below queue). Built on the D12 model, where contributions are
versioned: a correction never edits a contribution that backs a receipt or an
RTD filing, it supersedes the row with new ones on the same payment.

| Action | Where |
|---|---|
| 4 correct amount, 5 move, 6 move a receipt, 8 refund, 9 reallocate, 12 split a contribution, 10 merge contacts | `api/src/corrections/contribution-correction.ts` (the engine) plus `actions.ts` and `merge-contacts.ts` (each just builds a change list) |
| 7 split a receipt | `api/src/corrections/receipt-split.ts` |
| 3 lightweight reprint, lost status, "Copy" | `api/src/corrections/reprint.ts` |
| the guided over-limit proposal for 9 | `api/src/corrections/reallocation-proposal.ts` |
| routes | `api/src/routes/corrections.ts`: `POST /corrections/preview` and `POST /corrections` (one body shape for actions 4, 5, 8, 9, 10, 12), `POST /receipts/:id/split[-preview]`, `POST /receipts/:id/reprint`, `POST /contacts/:id/unmerge`, `GET /contacts` (donor picker), `GET /contributions/:id/reallocation-proposal` |
| screen 8 | `web/src/components/correction-panel.tsx` (on contribution detail: preview the cascade, then commit exactly what was previewed) and `receipt-actions.tsx` (cancel, reissue, lost copy, spelling fix, per receipt) |

Database (three migrations, `20260926*`): a receipt-allocated or RTD-included
contribution's material fields are frozen and a SUPERSEDED or REFUNDED row is
frozen entirely; a SUPERSEDED row must have a successor (checked at commit);
`receipt.reissuedFromId` is no longer unique so one receipt can be replaced by
several; `entity_report.filedAt`; `receipt_reprint`; `contact.mergedIntoId`.

What one commit does (one correlation id, all in the change log): supersede or
refund the contributions and correct the payment when asked; cancel every ISSUED
receipt that allocated to them, with the watermarked notice; issue the
replacements (the donor's own receipt is reissued carrying its untouched
contributions, anything moved to another donor or entity gets a fresh receipt);
queue a DC-1A for anything RTD-reported and a return note for anything inside a
filed report; close open validation findings on the retired rows; validate the
replacements. The preview computes all of it without writing and lists blockers
(kill switch, a donor with no printable address, a replacement with no period).

### Deviations / judgment calls

1. **A move does not consolidate into the new donor's existing receipt.**
   corrections.md action 5 says the new donor's receipt for the period is
   cancelled and reissued with the moved contribution. That would cancel a
   receipt EO may already hold in order to add a line whose printed date and
   goods-and-services flag are still an open question (O44), so the moved
   contribution gets its own new receipt instead. Consolidating is one
   `allocateToReceipt` plus a reissue away if that is wanted.
2. **A split must account for the whole contribution.** corrections.md says
   the parts must sum to "at most the payment amount"; action 12 requires
   parts equal to the contribution and points at correct-amount to change the
   total. The payment invariant (ACTIVE contributions sum to at most the
   payment) is enforced regardless, in code and by the deferred trigger.
3. **"In a filed return" is a new marker.** Nothing recorded that an entity
   report went into a filed AR-1, so `EntityReport.filedAt` was added. Nothing
   sets it yet (ticket 4.6 does), so the return-note step is exercised by tests
   and idle in practice until then.
4. **The non-deductible amount is never guessed.** A replacement whose amount
   differs from the original's must state its non-deductible amount when the
   original had one; a split's parts must add up to the original's.
5. **A replacement drops the EO contributor id when the donor changes, and
   always drops the year-expiry exception reason.** Both belong to the row's
   old facts.
6. **A spelling fix is judged by edit distance** (at most three characters and
   a quarter of the name, ignoring case, accents, and punctuation). It is a
   conservative heuristic: a refusal only sends the operator to a reissue.
   The receipt row and its snapshot are frozen (invariant 7), so a reprint is a
   `ReceiptReprint` row; the ALL and S2P2 reports read the name from the
   contact, so the corrected spelling reaches EO by fixing the contact.
7. **A lost receipt files as `L`** in the ALL report (an ISSUED receipt with
   `lost` set), following EO's spec column D. This closes the code half of
   open-questions O41; whether EO wants `L` rather than the receipt's own
   status still wants confirming.
8. **A merge is reversible only as a flag.** `unmerge` clears `mergedIntoId`;
   the contributions the merge moved stay on the surviving contact and go back
   with an ordinary move. Contacts are Qomon-owned, so the preview lists
   "merge it in Qomon too" as a follow-up. Nothing offers or accepts a merged
   contact afterwards.
9. **Reallocation needs `file EOForm`** (the party CFO and CFO designates), as
   the doc's "filer sign-off, initially $0 threshold, so always". There is no
   configurable threshold yet.
10. **Authority.** `correct Contribution` for any action, plus `correct
    Receipt` when receipts are cancelled or issued. A DC-1 designate has
    `correct Receipt` but not `correct Contribution`, so a designate cannot run
    the contribution actions today; that is a policy question, not changed here.
    A riding-scoped user may touch only their granted ridings.
11. **Not done:** no donor notice is actually sent (3.6, O24, O45 are unchanged),
    no UI for split-receipt or for unmerging (both are API-only), and PDFs are
    still rendered after the database commit, so a crash between them leaves a
    receipt without its PDF (the same window `issueReceipt` has).


## Tickets 3.6 and 3.12 (the rest): delivery

Receipts and pre-checks now go out. Email goes through a provider seam with a
Resend adapter; mail goes through print batches that someone prints, posts, and
marks mailed. The mailhouse booking (3.7) is not needed for this: a print batch
is one PDF that any printer can run.

| Where | What |
|---|---|
| `api/src/delivery/email-provider.ts` | The seam: `EmailProvider` has `send` and an optional `parseWebhook` that returns provider-neutral events. Nothing above it knows about Resend. |
| `api/src/delivery/resend-provider.ts` | Resend over plain `fetch`: `POST /emails` with base64 attachments and an `Idempotency-Key`; Svix-style webhook signature check (HMAC-SHA256, 5-minute tolerance, any `v1,` entry). 429, 5xx, and network errors are retryable; other 4xx are final. |
| `api/src/delivery/dev-provider.ts`, `provider-factory.ts` | `EMAIL_PROVIDER=dev` (the default) sends nothing; `resend` needs `RESEND_API_KEY`. A new provider is one adapter plus a case in the factory. |
| `api/src/delivery/outbox.ts` | `queueSpaceReceiptEmails`: one `EmailMessage` per EMAIL receipt still undelivered with no live email, receipt PDF attached, cover letter in the body. A donor with no email address is moved to MAIL. |
| `api/src/delivery/dispatcher.ts` | Sends queued rows (`FOR UPDATE SKIP LOCKED`, so replicas never double-send), throttled, with backoff retries. A send sets `Receipt.deliveredAt`. Started by `server.ts`, not `buildApp`. |
| `api/src/delivery/events.ts` | Applies webhook events. A permanent bounce, a suppression, or a final send failure moves the receipt and the donor's `DonorCyclePreference` to MAIL and opens a `DELIVERY` work item. |
| `api/src/delivery/print-batches.ts` | `createPrintBatch` (a window-envelope letter, then the receipt, per MAIL receipt), `markPrintBatchMailed` (sets `deliveredAt` to the mailing date, closes the DELIVERY items). |
| `api/src/delivery/space-delivery.ts` | The wizard's delivery summary, and the W6 moves: `issued` after a generate, `delivered` once every ISSUED receipt went out. Nothing moved `SpaceState` before this. |
| `api/src/routes/delivery.ts` | `GET /spaces/:p/:e/delivery`, `POST .../deliver/email`, `POST .../print-batches`, `GET /print-batches/:id/pdf`, `POST /print-batches/:id/mailed`, `POST /webhooks/email` (raw body, signature is the credential), and the sysadmin email tools (see the send guard below). |
| migration `20260927100000_delivery_infrastructure` | `email_message`, `email_event`, `print_batch`, `print_batch_item`, `WorkItemKind.DELIVERY`; all four tables never hard-delete. |
| `web/src/routes/space-issuance.tsx` | The Deliver step: cover letter, email send, print batches with mark-mailed, and bounced receipts. The pre-check card now takes the email's subject and message. |
| `web/src/routes/work-queue.tsx` | A Delivery tab on the work queue. |

Ticket 3.5's synchronous `deliverSpaceReceipts` and its `/deliver` route are
gone: the outbox and print batches replace both of its outputs.

### Deviations / judgment calls

1. **Sending is asynchronous.** The deliver step queues and returns. A space
   can hold thousands of receipts, and at Resend's 10 requests a second that is
   minutes, well past any request timeout. `EMAIL_RATE_PER_SECOND` defaults to
   5 to leave headroom.
2. **`deliveredAt` means sent, not received**: the provider accepted the email,
   or the batch went in the post. A later bounce clears it. This keeps email
   and mail meaning the same thing, and the dev provider (no webhooks) still
   completes a space.
3. **The bounce flips to MAIL at once**, rather than when someone resolves the
   work item. The backlog line reads "hard bounce -> WorkItem that flips the
   donor to MAIL"; flipping first means a bounced receipt cannot be forgotten,
   and the work item is the follow-up (check the address in Qomon), closed
   automatically when its batch is marked mailed. A complaint changes nothing:
   the email arrived. A pre-check bounce is recorded only, since an unconfirmed
   donor already defaults to mail.
4. **The kill switch holds receipt email**: queueing and printing refuse, and
   the dispatcher leaves receipt rows queued. Pre-check email still goes out,
   since it issues nothing.
5. **Warming the sending domain is operations, not code.** `EMAIL_DAILY_LIMIT`
   caps sends in any rolling 24 hours so the volume can ramp up; DNS (SPF, DKIM,
   DMARC on a subdomain) and the ramp schedule are set up in Resend.
6. **Wording stays caller-supplied**, as in 3.5: the cover letter, subjects, and
   pre-check message are typed into the wizard (the subjects are prefilled).
   There is still no stored template owned by the rules authority.
7. **Receipt numbers print in order**, not postal-code order. A mailhouse
   wanting presort discounts would need a different order; that is 3.7's call.
8. **`withChangeLog` takes an optional timeout.** Prisma's 5-second default
   is too short for a deliver step or a mark-mailed that touches a whole space.

### Not done

- No cancellation notice or replacement receipt is emailed automatically after
  a correction (3.10/3.11 still render them only). The outbox can carry them;
  the correction cascade does not queue them yet.
- The Qomon activity log (O45) is unchanged: the change log and the
  `email_event` rows are the record of every send.
- Nothing here was clicked through; see PHASE-3-MANUAL-TEST-PLAN.md section 6.
  The Resend adapter is tested against a stubbed `fetch` and signed webhook
  requests, not against a live Resend account.

### The email log and the live-sending guard

Nothing leaves the system unless three things hold: the environment allows it
(`EMAIL_LIVE_SENDING_ALLOWED=true`, production only), a sysadmin has turned on
**Send real email** under Admin > Emails (`EmailDeliverySettings`, off by
default, change-logged), and the provider is a real one (the dev adapter never
counts). Otherwise the dispatcher simulates each send: the row is marked SENT
with a local `simulated_` id and `simulated` set, and the receipt is marked
delivered, so staging behaves end to end. The env flag is the hard stop: a
database copied from production brings its toggle with it, but not the flag.

| Where | What |
|---|---|
| `api/src/delivery/send-mode.ts` | `getEmailDeliverySettings`, `setLiveSending` (refuses "on" where the env disallows it or the provider is dev), `resolveEmailSendMode`. |
| `api/src/delivery/dispatcher.ts` | Resolves the mode once per pass; `liveSendingAllowed` is a required dependency, so no caller can forget it. |
| `api/src/routes/delivery.ts` | Sysadmin-only: `GET /admin/emails` (filters: status, kind, real or simulated, search by address, donor, or receipt number; cursor pagination), `GET /admin/emails/:id` (body and provider events), `GET`/`PUT /admin/email-settings`, `POST /admin/emails/dispatch`, and `POST /admin/emails/:id/simulate`, now allowed for any simulated email and refused for a real one. |
| migration `20260927110000_email_send_guard` | `email_delivery_settings`, `email_message.simulated`, `ChangeLogSubjectType.EmailDeliverySettings`. |
| `web/src/routes/admin-emails.tsx` | Admin > Emails: the switch (locked with an explanation where the env disallows it) and the email log, with a row opening to the body, events, and simulate buttons. Replaces the Dev tools outbox card. |

The log is sysadmin-only because bodies carry donor details and a pre-check
body carries a live confirmation link.
