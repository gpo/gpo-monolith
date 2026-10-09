---
last-reviewed: 2026-10-06
review-interval-days: 180
---

# Why this tool exists

[Back to the guide](README.md)

## The job

The GPO must issue Elections Ontario (EO) tax receipts for every eligible
contribution to the party, its 124 constituency associations (CAs), their
campaigns, and leadership contestants. It must also report those
contributions to EO on two clocks:

- **Real-time disclosure (RTD).** Any contributor whose giving to the party
  passes $200 in a calendar year is disclosed to EO within 15 business days
  of the deposit.
- **Annual reports.** After each year or election period, a per-entity
  roster of every receipt (the ALL file) and a summary of contributors over
  $200 (the S2P2 file), which feed each entity's annual return.

The rules come from Ontario's Election Finances Act: only the party CFO or
an authorized designate may issue receipts, contribution limits apply per
entity, cash over $25 is not allowed, out-of-province contributors are not
eligible, and so on.

## How it worked before

Until this tool, the process ran on CiviCRM plus a chain of manual steps:
hand-run SQL to pull a trial list of receipts, a fix-and-re-pull loop
editing CiviCRM by hand until the list was clean, a master Google Sheet, an
Apps Script that split the sheet into EO's report files, and a Node script
that stamped receipt PDFs from a CSV. RTD ran from a separate Drupal module.
The pain showed up in three ways:

- **Corrections were punishing.** Any change after a receipt went out was a
  manual runbook of five to ten steps: cancel in CiviCRM, re-enter, reissue,
  watermark the old PDF "CANCELLED" by hand, prepare EO's cancellation
  form, notify the donor, file copies, and adjust the reports. CiviCRM could
  not attach two receipts to one contribution, so a small fix often meant
  cancelling and re-entering a donor's whole year. This was routine, not
  rare.
- **Nobody could say what EO knew.** There was no change log. Edits made
  after a contribution had been disclosed to EO went unnoticed, and because
  nobody could tell which entity reports had changed, all of them were
  re-sent.
- **The rules lived in many places.** The same checks (periods, ridings,
  postal codes, entity types) were copied across several SQL files, the
  Apps Script, and the warehouse, with no automated tests, and receipt
  numbers came from "the highest number so far, plus one."

On top of that, CiviCRM is being decommissioned and Qomon, the GPO's new
CRM, does not do receipting or EO reporting. Without this tool there would
be no way to run the 2026 receipt cycle.

## What the tool promises

Everything in the tool exists to keep five promises. They are enforced by
the database itself, not just by the screens, so no workaround can break
them.

1. **No contribution dollar is receipted twice.** The total issued against
   a contribution can never exceed its eligible amount, even when it is
   split across several receipts.
2. **Receipt numbers are sacred.** They come from one sequence, are never
   reused, and are never freed up by a cancellation.
3. **Nothing is deleted.** Contributions, receipts, and log entries are
   cancelled, voided, or superseded, never removed. This is a regulatory
   requirement.
4. **Every change is evidenced.** Each change records who made it, why, and
   what the record looked like before and after, in the same step as the
   change itself. Every receipt and filing keeps a snapshot of the exact
   data it was produced from.
5. **A change to anything EO has seen goes through a correction.** Once a
   contribution is on a receipt or in an RTD filing, it can only change
   through a guarded correction action, which produces the cancellations,
   replacements, and EO paperwork that change requires.

## What it is not

- **Not a payment processor.** Money moves through Qomon and the payment
  processors; the tool records and receipts it.
- **Not a CRM.** Qomon remains the home of contact records. When Qomon is
  connected, the tool creates and edits contacts in Qomon first.
- **Not connected to CiviCRM.** History arrives once, as a one-time
  extract.

## How it changes the work

| Before | With the tool |
|---|---|
| Problems found at year end, in a trial pull | Every contribution is checked the moment it arrives; problems wait in the [work queue](work-queue.md) |
| Corrections by hand, five to ten steps each | One [correction action](corrections.md), previewed first, with the cancellation, replacement, and EO paperwork generated |
| Re-send every entity report to be safe | Each [entity report](entity-reports.md) shows whether anything in it changed since it was sent |
| No record of who changed what | A [change log](change-log.md) of every change, exportable for EO |
| RTD marker missed later edits | The tool knows exactly what each [RTD filing](rtd-filings.md) contained and queues an amendment when a reported contribution changes |
| Receipt numbers from "max plus one" | One protected sequence |

## EO approval

EO must approve an electronic receipting system before a party may use it.
EO's Electronic Database Evaluation scores the system against a checklist
(user management, audit trail, contributor records, receipt contents,
reporting, and so on). Many features in the tool, such as admin-defined
roles, the change log export, and the contributor-type line on receipts,
exist to meet specific rows of that checklist.
