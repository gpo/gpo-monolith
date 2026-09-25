# Phase 3 — Manual Test Plan

Companion to [`PHASE-2-MANUAL-TEST-PLAN.md`](PHASE-2-MANUAL-TEST-PLAN.md) —
reuse its Setup section (which reuses Phase 1's: server, web app, dev
logins). This doc only covers what Phase 3 adds. **It is built
incrementally, ticket by ticket, as Phase 3 lands** — right now that's
tickets 3.1 (individual receipt issuance), 3.12's first slice (per-space
issuance), and 3.2 (allocation consolidation, §3 below). Sections for 3.3
onward will be added as they're built.

## 0. Getting Phase 3 fixture data into your database

Testing per-space issuance needs more than one throwaway contribution: you
need whole **spaces** (period × riding × entity kind) shaped to show a clean
batch, a blocked batch, and a batch that partially fails. Use the fixture
seed script — as of 2026-09-22 this is the same single script Phase 2 uses,
just its "Group 2" and "Group 3":

```bash
cd apps/tax-receipts/api
set -a; source .env; set +a     # or your own env, pointed at the DEV db (:5434), not test (:5433)
pnpm exec prisma migrate deploy
pnpm db:seed                    # periods, limits, holidays, kill switch, users, the real riding directory
pnpm db:seed:fixtures           # Group 1 (Phase 2's per-rule fixtures) + Group 2 (below) + Group 3 (§3)
```

Safe to run more than once: every contact/contribution is keyed by a
reserved id range (`900001`-`900010` for contacts, `900001`-`900012` plus
`900101`/`900102` for a few of Rambling Randy's contributions; `910001`-
`910002` for §3's consolidated-receipt donor), every `Period` it needs is
create-if-absent. It needs `pnpm db:seed` run first: it looks up the party
CFO user (`cfo@gpo.test`) to issue "Already Issued Ivy"'s receipt as, Space
B's block depends on the 2026 CA contribution limit `db:seed` creates, and
(see below) Spaces B/C/D borrow real riding numbers from the directory
`db:seed` loads, so it must run first, not just "first the first time."
**Local/dev database only** — don't point it at a shared environment with
real riding config or real donor data. See the script's header comment
(`apps/tax-receipts/api/prisma/seed-fixtures.ts`) for the full id-range
table and rationale.

The script prints what it created, grouped by space, then runs the
validation registry over everything so Space B's blocking work item already
exists by the time it finishes, and excepts "No Address Ned"'s `C1` finding
on purpose (Space D's section below explains why).

**Space A deliberately does not live in the real 2026 Annual period (67).**
That period is the one shared PARTY-level space every other PARTY-level
fixture — and any real Qomon-mirrored contribution — also lands in, so on
a dev database that has seen any real use it is never actually clean (this
was caught by running the wizard against a real dev database while building
these fixtures: `PARTY`/67 already had a dozen-plus open work items from
Phase 1/2 fixtures and real mirror-sweep data). Space A instead gets its own
fixture-only period, **9502**, dated 2028 so it can't collide with any real
period's date range either.

**Spaces B, C, and D used to sit on ridings 84 and 90.** Those numbers were
picked before any real riding data existed in a dev database; `pnpm db:seed`
now loads the real 124-riding Elections Ontario directory
(`ontario-ridings.json`), and 84/90 turned out to be real ridings (Parry
Sound—Muskoka, St. Catharines) with nothing to do with the "York-Simcoe" and
"Simcoe North" fixture names they'd been given. There's no "fixture-only"
riding number to move them to either — rule A2 validates every riding
number against the real 1-124 range, so an out-of-range number just trips a
different, wrong finding instead of dodging the collision (confirmed by
actually running the renumbered-to-9000s version of this script and diffing
against §1's expected-findings table before landing on this fix). Renumbered
2026-09-22 onto the real ridings their names were actually describing: **121
(York—Simcoe)** for Spaces B and C, **100 (Simcoe North)** for Space D — used
as ordinary active ridings, nothing about them forced or overridden. See
`seed-fixtures.ts`'s header comment for the full id-range table and for the
one riding this script *does* force (12, for the Phase 2 "defunct riding"
fixture).

## 1. What each seeded space and donor illustrates

Open **Dashboard** (the space grid) as any signed-in user — you should see
five new rows beyond whatever Phase 1/2 fixtures already put there. Each
row's **Issue** button opens the per-space wizard at
`/spaces/$periodId/$entityKind/issue`.

### Space A — PARTY / phase-3 fixture period 9502 (no riding): clean, ready to issue

The baseline "click Issue, everything works" case.

| Donor | Illustrates |
|---|---|
| Ready Rita | Clean contribution, full $50.00 remaining, no delivery preference on file — previews as `MAIL` (the default). |
| Ready Raj | Clean, $75.00 remaining, has a confirmed `DonorCyclePreference` of `EMAIL` for 2028 — previews as `EMAIL` and is the one contributing to the preview's email/mail split. |
| Partial Credit Priya | $100.00 contribution with $20.00 marked non-deductible (goods & services) — the preview shows $80.00 remaining, not $100.00 (invariant 1). |
| Already Issued Ivy | Pre-issued by the seed script itself (as the party CFO) — nothing left eligible, so **this row should not appear in the preview at all**. Check her contribution detail page instead: one receipt, already there. |
| Rambling Randy (leg 1/3) | Clean, $40.00 — see below; the same donor also gives into Space C and Space F. |
| Consolidating Chris | Two contributions ($40.00 + $25.00) pre-issued onto a **single** receipt via `allocateToReceipt` — also excluded from the preview (nothing left eligible on either). See §3 below (ticket 3.2) for what this demonstrates. |

Expected preview: 4 lines (Rita, Raj, Priya, Randy), **not** 6 — Ivy and
Chris are both fully allocated already. Totals: receipt count 4, amount
$245.00 (50+75+80+40), 1 email (Raj), 3 mail.

Checks (verified 2026-09-20 against a real dev database while building
these fixtures — the four receipts below already exist there; expect an
empty preview on that database and a fresh 4-line one on any other):

- [x] Preview shows exactly those 4 lines and those totals.
- [x] Generate succeeds for all 4; each gets a `GPO-` receipt number and a
      viewable PDF.
- [ ] Ivy's existing receipt is untouched (still just the one, from before
      you ran the wizard).

### Space B — CA / riding 121 (York—Simcoe) / 2026 Annual: blocked end-to-end

Shows that the gate blocks the **whole space**, not just the contribution
that actually failed a rule.

| Donor | Illustrates |
|---|---|
| Blocked Blake | A single $3,500.00 contribution to a CA, over the $3,425 2026 CA limit (`ContributionLimit`, `db:seed`) — trips rule **B2** on its own, no other contributions needed. Its open work item is what blocks the space. |
| Clean Casey | $55.00, otherwise entirely clean. The point of this row: it is blocked anyway, purely because it shares a space with Blake. |

Checks:

- [ ] The wizard's Review step shows "1 open work item(s) block issuance
      for this space," listing Blake with rule `B2`, and disables "Next:
      generate."
- [ ] Casey does **not** appear anywhere in this blocked view — the preview
      shows zero lines while blocked, by design (nothing meaningful to
      preview until the queue clears).
- [ ] Resolve or except Blake's `B2` item from the work queue, refresh the
      preview — it should now show both Blake and Casey as issuable (Blake
      for his full $3,500.00 remaining, since resolving a work item doesn't
      change the amount).

### Space C — CAMPAIGN / riding 121 (York—Simcoe) / fixture by-election (period 9501): clean

A second clean space, at a different entity kind and period, so it's
visibly a separate wizard run from Space A.

| Donor | Illustrates |
|---|---|
| Campaign Cam | Clean, $35.00. |
| Rambling Randy (leg 3/3) | Clean, $30.00 — his third space. |
| By-Election Donor (Group 1) | Clean, $50.00 — Group 1's A2-pass fixture lands in this same space, since `db:seed:fixtures` always seeds Groups 1-3 together now (they used to be two separate scripts you could run independently). |

Checks:

- [ ] Preview shows all three lines, totals $115.00 across 3 receipts
      (verified 2026-09-20 against the two-script version of this fixture
      set; recheck after the 2026-09-22 consolidation).
- [ ] Generating here does not touch Space A or Space F, even though Randy
      appears in all three — one receipt per contribution, per space.

### Space D — CA / riding 100 (Simcoe North) / 2026 Annual: partial failure on generate

Shows that one row's real-world failure (no address) doesn't stop the rest
of the batch.

| Donor | Illustrates |
|---|---|
| No Address Ned | No address on file at all — this genuinely trips rule `C1` (no address), which would otherwise block the whole space like Space B. The seed script deliberately **excepts** that finding (not resolves — nothing about the missing address changed) so the gate clears and this space can demonstrate its actual point: an exception clears the queue without fixing the underlying data, so issuance itself still fails on the real gap. |
| Address Andy | Clean, $65.00 — must succeed even though Ned, in the same generate call, fails. |

Checks (verified 2026-09-20 against a real dev database — Andy's receipt
already exists there; Ned's row will still fail every time until his
address is fixed):

- [x] Preview shows both lines (the gate only checks open work items, not
      addresses — an excepted `C1` doesn't block, and the preview can't
      know issuance will fail here anyway).
- [x] Generate: Andy's row shows a receipt number; Ned's row shows an error
      mentioning "address" instead — `succeeded: 1, failed: 1` in the
      result banner. (Also confirmed a PDF is fetchable for Andy's receipt.)
- [ ] Fix Ned's address in Qomon (or directly in the dev database for a
      manual test), re-run generate for the same space — Ned now succeeds
      too.

### Space F — PARTY / 2025 Annual (period 63): clean, a different period

| Donor | Illustrates |
|---|---|
| Rambling Randy (leg 2/3) | Clean, $60.00, dated mid-2025 — his second space, proving one donor's contributions land in whichever space each one's own period/riding/entity resolves to, independent of any other contribution he's made. |

Checks:

- [ ] Randy's contribution detail page shows three separate allocations
      once you've generated all three spaces (Space A, C, and F) — three
      different receipts, three different periods/ridings/entities, one
      donor.

## 2. Repeatable-for-stragglers, by hand

The fixtures don't simulate a late arrival (that would break the script's
idempotency), so exercise it manually: after generating Space A above, seed
one more `PARTY` contribution against period **9502** (no riding) by hand
(contribution detail's "waiting on metadata" empty state won't apply if you
set metadata directly, or reuse the Phase 1 manual-test-plan's
single-contribution seeding steps). Re-open Space A's wizard — the preview
should show exactly that one new line; generating again should not touch
the 4 already-issued contributions.

## 3. Allocation consolidation (ticket 3.2)

`db:seed:fixtures`' Group 3 seeds **Consolidating Chris** (`910001`/`910002`)
directly into Space A: two contributions, $40.00 and $25.00, both allocated
onto the **same** receipt via `allocateToReceipt` rather than one receipt
each. This is the first fixture data exercising `ReceiptAllocation` as
actually many-to-many (every other fixture in this file, and everything
3.1/3.12 ever issue through the wizard, is still one contribution -> one
receipt).

- [ ] Chris's contribution detail page (either contribution) shows a
      receipt with **two** allocations and a $65.00 total, not $40.00 or
      $25.00.
- [ ] Space A's preview excludes both of Chris's contributions (same as
      Ivy) — nothing left eligible on either.
- [ ] Deliberately try generating an ALL or S2P2 entity report for period
      9502 (Admin → Entity reports, or `POST /reports/all` /
      `POST /reports/s2p2` directly). Expect it to **fail** with
      `MultiAllocationReceiptError` naming Chris's receipt. This is the
      known, intentional gap behind open-questions.md **O44** (private
      repo) — the report generators don't yet know which contribution's
      accepted date or goods/services flag should print for a consolidated
      receipt, so they refuse to guess rather than emit a wrong number.
      Confirming this error is the point of this check, not a bug to chase.
- [ ] No web UI calls `allocateToReceipt` yet (same gap 3.1 left for
      `issueReceipt`) — there's nothing to click for this ticket beyond
      what's already seeded; the API/service layer is what ticket 3.2
      shipped.

## 4. Correction actions (tickets 3.10, 3.11, 3.14)

The API is covered by tests; these are the checks worth a human pass on the
screen (nothing here was clicked through when it was built). Use a receipted
fixture donor, for example one of Space A's.

- [ ] Open a receipted contribution. The **Correct this contribution** card is
      there for an administrator, party CFO, or rules authority, and absent for
      a read-only user.
- [ ] Correct the amount to something smaller, tick "the payment itself was
      mis-keyed", give a reason, **Preview cascade**. The preview names the old
      receipt to cancel and a new one "cancels and replaces GPO-...", and shows
      the "Qomon still shows ..." follow-up. **Commit correction** stays
      disabled until you preview; change any field afterwards and the preview
      disappears.
- [ ] Commit it. The page now shows the contribution as history, and its
      change-log slice has the reason. Open the new receipt's PDF: every copy
      carries "This cancels and replaces receipt #...".
- [ ] Preview a **Move** to a donor with no address: the preview shows the
      blocker and commit stays disabled.
- [ ] **Split** a contribution between two donors: the parts total turns green
      only when it matches the contribution. Both donors end up with a receipt;
      only the original donor's says it replaces the old one.
- [ ] **Reallocate** (party CFO only): "Show over-limit proposal" on a donor over
      the party limit offers a CA with the room available, and "Use this" fills
      the parts.
- [ ] Receipt row → **Correct** → **Reprint as a lost-receipt copy**: the PDF is
      stamped COPY, the receipt stays valid, and the next ALL report lists it
      with Receipt_Status L. **Fix the spelling** with a different person's name
      is refused with a pointer to reissue.
- [ ] RTD-reported contribution: any correction queues a DC-1A on the work
      queue's owed-to-EO tab, once, even when its receipt is cancelled as well.

## 5. Manual entry form

Nothing here was clicked through when it was built. Use any donor already in
the dev database (contacts are not created from the form).

- [ ] Contributions → **Add payment** (party CFO or administrator; absent for a
      read-only user). Pick a donor by typing two letters of their name.
- [ ] Enter an amount and a received date. Under the contribution, "Will be
      filed in ..." names the period for that date; pick a date with no
      configured period and the form warns you instead.
- [ ] Save. The next screen links to the new contribution; its Payment card shows
      source MANUAL and no Qomon transaction.
- [ ] **Split across more contributions**: give two donors part each; the running
      total turns green at the full amount and red above it (save is refused).
- [ ] Choose Recipient = Constituency association: saving without a riding is
      refused; typing a riding shows its name.
- [ ] Enter a payment for less than the full amount attributed. Its contribution's
      page shows "... is not attributed" with **Attribute the rest**, which adds
      a contribution for another donor, and the notice goes away.
- [ ] A payment dated December 31 lands in that year's period, not the next.

## Known non-issues

- No Address Ned's work queue entry shows `C1`, status `EXCEPTION`, with a
  resolution note naming this fixture script — that's intentional (see
  Space D above), not a stray leftover to clean up.
- Delivery (email/print, Qomon activity logging — tickets 3.5/3.6) isn't
  built. Raj's `EMAIL` preference changes what the preview and the issued
  receipt *say* about delivery; nothing is actually sent.
- A dev database that already has other PARTY-level, riding-84-CA, or
  riding-90-CA contributions (real mirror-sweep data, your own manual
  testing) will add extra lines or blockers to whichever of these spaces
  they land in. Space A is immune to this by construction (its fixture-only
  period can't collide with anything); Spaces B, C, D, and F use real
  periods/ridings and can't make the same guarantee.
