# Phase 2 — Manual Test Plan

Companion to [`PHASE-1-MANUAL-TEST-PLAN.md`](PHASE-1-MANUAL-TEST-PLAN.md) —
reuse its Setup section (server, web app, dev logins). This doc only covers
what Phase 2 adds. **It is built incrementally, ticket by ticket, as Phase 2
lands** — right now that's ticket 2.1 only. Sections for 2.2 onward will be
added as they're built; until then, see "What's not here yet" at the bottom.

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
pnpm db:seed                    # periods, limits, holidays, kill switch, users (unchanged from Phase 1)
pnpm db:seed:fixtures           # NEW: 15 contacts / 17 contributions shaped to exercise every 2.1 rule
```

It's safe to run more than once — every contact/contribution is keyed by a
reserved id range (`800001`–`800017`) and skipped if already present; every
`Riding` it creates is create-if-absent so it never overwrites real riding
config. **Local/dev database only** — don't point it at a shared environment
with real riding config or real donor data. See the script's header comment
(`apps/tax-receipts/api/prisma/seed-phase-2-fixtures.ts`) for the full
rationale.

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
- [ ] Flip riding 84 (`York-Simcoe (fixture)`) inactive via
      Admin → Ridings (sysadmin), re-run validation — confirm (verified
      2026-09-18 against these exact fixtures):
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

      Flip riding 84 back to active afterward — confirm all three return to
      the table above — so the fixture set stays accurate for the next
      person.
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

## What's not here yet

Tickets 2.2–2.8 (RTD draft builder, `RtdInclusion` stamping, DC-1A
generation, filing archive, the December-straddle case, the RTD filings
screen, the shadow-run harness) aren't built. The three "Threshold Crossing
Donor" fixtures above exist so there's already-correct data for 2.2's
row-inclusion logic once it lands (one contact, three deposits — $150, then
$100 crossing the $200 aggregate, then $75 — spread across 2026); there's
nothing to click yet. This doc gets a new numbered section per ticket as
each one ships, same as `PHASE-1-MANUAL-TEST-PLAN.md` did.

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
