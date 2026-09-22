# Phase 2 — Manual Test Plan

Companion to [`PHASE-1-MANUAL-TEST-PLAN.md`](PHASE-1-MANUAL-TEST-PLAN.md) —
reuse its Setup section (server, web app, dev logins). This doc only covers
what Phase 2 adds. **It is built incrementally, ticket by ticket, as Phase 2
lands** — as of 2026-09-22 that's rule coverage (2.1, §1) and the RTD flow
(2.2/2.3/2.4/2.6/2.8, §2). 2.5 (shadow-run harness) is still `todo`
(STATUS.md) — nothing to test yet.

## 0. Getting Phase 2 fixture data into your database

Phase 1's manual test plan has you seed one throwaway contribution by hand.
That's not enough to exercise 11 different validation rules, and real Qomon
sandbox data isn't reliably available yet (no confirmed riding-resolvable
`group_id`, no confirmed metadata field — see STATUS.md B3/B5). Until that
changes, use the fixture seed script instead:

```bash
cd apps/tax-receipts/api
set -a; source .env; set +a     # or your own env, pointed at the DEV db (:5434), not test (:5433)
pnpm exec prisma migrate deploy
pnpm db:seed                    # periods, limits, holidays, kill switch, users, the real riding directory
pnpm db:seed:fixtures           # 15 contacts / 17 contributions shaped to exercise every 2.1 rule
```

`db:seed:fixtures` (`apps/tax-receipts/api/prisma/seed-fixtures.ts`) is a
single consolidated script — as of 2026-09-22 it also carries what used to
be `seed-phase-3-fixtures.ts`'s space-issuance fixtures and a new group for
ticket 3.2. This section only concerns "Group 1" (`800001`–`800017`); see
[`PHASE-3-MANUAL-TEST-PLAN.md`](PHASE-3-MANUAL-TEST-PLAN.md) for Groups 2–3.
It's safe to run more than once — every contact/contribution is keyed by a
reserved id range and skipped if already present. **Local/dev database
only** — don't point it at a shared environment with real riding config or
real donor data. See the script's header comment for the full id-range table
and rationale, including why this fixture set can't reserve a "fixture-only"
riding number the way it can a period id (rule A2 validates every riding
number against the real 1-124 range) and instead borrows real riding **121**
(York—Simcoe) for the "active riding" cases below, and forces real riding
**12** (Brampton West) inactive for the one fixture that needs a defunct
riding (restored the next time you run `pnpm db:seed`).

The script prints what it created, then runs the validation registry over
everything and prints `checked/opened/reopened/resolved` counts. That last
step means you don't need to separately trigger `POST
/internal/validation/run` — the fixtures already have their work items when
the script finishes.

## 1. Rule coverage (ticket 2.1)

Go to **Work queue → Validation** as any signed-in user, or query the
contribution detail page for each fixture contact by name. Confirmed output
(this is what the script actually produced when last run — treat any
mismatch on your machine as worth investigating, not "probably fine"):

| Contact | Demonstrates | Expected open `ruleRef`s |
|---|---|---|
| Baseline Donor | clean contribution | *(none)* |
| Active CA Donor | A2/A3 pass — CA in an active riding | *(none)* |
| Defunct CA Donor | A3 — CA in a defunct riding | `A3` |
| No-Campaign Donor | A2 — CAMPAIGN, no active campaign for an ANNUAL period | `A2` |
| By-Election Donor | A2 pass — CAMPAIGN in a by-election period naming the riding | *(none)* |
| Provenance Mismatch Donor | A4 — processor record but `received_by` ENTITY | `A4` |
| Out Of Province Donor | B1 + C3 — BC address | `B1`, `C3` |
| Anonymous *(800008)* | B3 + C4 — "Anonymous" trips both | `B3`, `C4` |
| No Address Donor | C1 — no address at all | `C1` |
| Comma Address Donor | C2 — comma in the address line | `C2` |
| Bad Postal Donor | C3 — malformed postal code | `C3` |
| D. Smith | C4 — initial instead of a full name | `C4` |
| June and John Smith | C4 — joint name | `C4` |
| Anonymous *(800014, "kitchen sink")* | B1 + B3 + C2 + C3 + C4 all at once | `B1`, `B3`, `C2`, `C3`, `C4` |
| Threshold Crossing Donor ×3 | RTD prep (not testable until 2.2 — see below) | *(none)* |

Checks:

- [ ] Each row above matches what you see in Work queue → Validation
      (filter by contact name, or by `ruleRef`).
- [ ] Resolve "Defunct CA Donor"'s `A3` item with a reason — confirm it
      moves to RESOLVED. Re-run `POST /internal/validation/run` (sysadmin)
      — confirm it **reopens** (the underlying riding is still inactive;
      this is the "regression" path ticket 1.7 already covers, just
      exercised on a new rule).
- [ ] Except (not resolve) "No Address Donor"'s `C1` item with a reason —
      confirm it moves to EXCEPTION and drops out of the OPEN view.
- [ ] Flip riding **121** (`York—Simcoe`) inactive via Admin → Ridings
      (sysadmin), re-run validation — confirm (verified 2026-09-18 against
      these exact fixtures on the riding then numbered 84; behaviour
      unchanged by the 2026-09-22 renumbering, only the number is different):
      - "Active CA Donor" now also gets `A3` (the CA case: defunct riding).
      - "No-Campaign Donor" still shows `A2` (was already failing, for the
        period-not-election reason, not the riding).
      - "By-Election Donor" **also newly gets `A2`** — campaign eligibility
        checks `Riding.active` too (`isEntityEligible` in
        `packages/tax-receipts-core/src/space/eligibility.ts` requires an
        active riding before it even looks at the period), so a defunct
        riding fails a campaign there regardless of an otherwise-valid
        by-election period. If that surprises you, it surprised the person
        who wrote this doc too until they actually ran it — worth
        confirming this is the intended reading of A3 the next time
        validation-rules.md gets reviewed, not just accepting the code as
        the spec.

      Flip riding 121 back to active afterward — confirm all three return
      to the table above — so the fixture set stays accurate for the next
      person. **This really is a real riding** — see this doc's Setup note
      and `seed-fixtures.ts`'s header comment: rule A2 validates every riding
      number against the real 1-124 Elections Ontario range, so there's no
      such thing as a "fixture-only" riding number to toggle instead. This
      step (and the pre-seeded "Defunct CA Donor" fixture, which borrows
      riding **12** and is forced inactive by the seed script itself, not by
      you) is safe only because you're on a local/dev database, not a shared
      one — same warning this doc already gives about riding config in
      general.
- [ ] **Database check** — same idea as Phase 1's, scoped to the fixture
      range:
      ```sql
      select c.name, w."ruleRef", w.status
        from work_item w
        join contribution co on co.id = w."subjectId" and w."subjectType" = 'Contribution'
        join contact c on c.id = co."contactId"
        where co."qomonTransactionId" between 800001 and 800017
        order by co."qomonTransactionId";
      ```

## 2. RTD flow (tickets 2.2, 2.3, 2.4, 2.6, 2.8) — walk it through on Threshold Crossing Donor

Tickets 2.2-2.8 landed 2026-09-21/22 (STATUS.md). Rather than seed a
separate, already-filed dataset, this walkthrough reuses the "Threshold
Crossing Donor" fixtures already seeded above (`800015`-`800017`: $150,
then $100 crossing the $200 RTD aggregate, then $75, all PARTY / GPO /
2026) — the point of an RTD screen walkthrough is going through draft ->
stamp -> archive -> DC-1A yourself, not looking at data someone else already
pushed through it. These three rows are clean (no open A1/C4/B1/B2 findings)
so nothing here should be gated.

- [ ] **Draft (2.2)**: RTD filings screen (screen 9) -> build a draft for
      year 2026. Confirm all three of Threshold Crossing Donor's deposits
      appear, and that only the second ($100) and third ($75) are rows (the
      first, at $150, stays under the $200 aggregate) — same rule test-plan
      §2 item 6 describes.
- [ ] **Stamp (2.3)**: select the draft's rows, stamp a filing. Confirm a
      `RtdFiling` is created and both rows now show an `RtdInclusion`.
- [ ] **Archive (2.6)**: export the stamped filing as CSV (or pipe). Confirm
      the download has the EO header row and both rows.
- [ ] **Filings screen (2.8)**: confirm the new filing appears in the
      filings list/table with the right name
      (`2026_RTD_<PartyID>_MMDDYYYYHHMM`) and a working download link.
- [ ] **DC-1A (2.4)**: from the now-RTD-reported second deposit ($100),
      generate a DC-1A amendment (`POST /rtd/contributions/:id/dc1a` — no
      screen trigger yet, screens.md frames the trigger as the owed-to-EO
      queue, which ticket 3.10 hasn't built). Confirm it references the
      original filing via `amendsFilingId` and renders a form artifact.
- [ ] **December-straddle (2.7)**: not exercised manually here on purpose —
      it needs a live 2027 period this fixture set deliberately doesn't
      invent (a fake future EO period id is exactly the kind of thing that
      could later be mistaken for a real one). It's covered end to end by
      the automated regression test instead:
      `apps/tax-receipts/api/src/rtd/december-straddle.test.ts`.
- [ ] **Shadow-run harness (2.5)**: still `todo` in STATUS.md (blocked on
      the CiviCRM historical extract, ticket 1.17) — nothing to test yet.

## Known non-issues

- Rules **A9** (G&S invoice matching) and **B5** (cheque payer name) are not
  implemented — no data source exists for either (open questions O35, O36
  in the private spec repo). Don't expect fixtures for them; there aren't
  any.
- A3's "no placeholder ids / 'None'/'NIL'" clause isn't checked — only the
  entity-active half is (open question O37).
- If you seeded a Phase 1 sandbox/manual contribution before running
  `db:seed:fixtures`, re-running validation may open new `C1` (no address)
  or `B3`/`C4` (name) findings against **that** data too — this is correct,
  not a bug: those rules are new in 2.1 and apply to everything, not just
  the new fixtures. It's a good opportunity to check your old test data
  through fresh eyes rather than something to work around.
