---
last-reviewed: 2026-10-06
review-interval-days: 90
---

# Key concepts

[Back to the guide](README.md)

The terms the tool's screens use, and how they relate. If a screen is
confusing, the answer is usually here.

## Money and people

**Payment.** A money event: one cheque, one online donation, one cash
deposit. It has an amount, a date received, a method (card, cheque, cash,
pre-authorized debit, EFT, in-kind, or other), and a state (received,
unpaid, refunded, bank error, or other). Only a *received* payment counts
toward receipting and RTD.

**Contribution.** The tax attribution of some or all of a payment: who gave,
how much, to which entity, in which period. A payment normally carries one
contribution, but can carry several: a $500 cheque might be $300 to the
party and $200 to a riding association. The contributions on a payment can
add up to less than the payment (the rest is still to be attributed), but
never more.

**Contributor (contact, donor).** The person who gave. Ontario accepts
political contributions from individuals only, so every contributor's type
is *Individual*. Contact records belong to Qomon when Qomon is connected;
see [Contributors](contributors.md).

**Eligible amount.** The contribution amount minus any non-deductible
portion (for example, the value of a dinner at a fundraising event). Only
the eligible amount can be receipted.

## Where the money goes: two separate questions

The tool keeps two questions apart that the old system blurred together.

**Directed to** (entity kind, plus a riding where relevant):

| Entity kind | Means | Riding |
|---|---|---|
| Party | The Green Party of Ontario itself | None |
| CA | A constituency association | Required (1 to 124) |
| Campaign | A candidate's campaign in an election | Required |
| Leadership | A leadership contestant | None; names the contestant instead |

**Received by**: who physically took the money in.

| Received by | Means |
|---|---|
| GPO | The central party received it (any online donation through a processor is always GPO) |
| Entity | The CA or campaign received it directly |

**Agency contribution.** A contribution received by GPO but directed to
another entity, for example an online donation to a riding association. The
tool derives this flag; nobody sets it by hand. It matters for EO reporting
and for the agency fee.

## Time

**Period.** An EO contribution period: the annual period for a year, a
general election period, or a by-election period (scoped to one riding).
Each has an EO period id and a start and end. The tool assigns each
contribution to a period from its acceptance date, and an election period
wins over the annual one. Periods are set up under
[Administration](administration.md#annual-settings).

**Contribution year.** The calendar year in Ontario time. Contribution
limits and the RTD $200 threshold are per contribution year.

## Spaces

**Space.** One period, one riding (or none, for party-level), and one entity
kind: for example "2026 annual, riding 121, CA." Receipts are issued and
entity reports are generated one space at a time. Spaces are not created by
hand: a space exists as soon as a contribution lands in it.

**Stage.** How far a space has got through the year's work:

| Stage | Means |
|---|---|
| intake | Contributions are arriving and being checked |
| queue-clear | No open validation problems remain |
| reconciled | Contributions are matched to deposits |
| issued | Receipts have been issued |
| delivered | Every issued receipt has been emailed or mailed |
| reported | The entity reports have been generated |
| sent-to-cfo | The reports have gone to the entity's CFO |

Today the tool moves a space to *issued* and *delivered* on its own; the
other moves are not yet automated (see [Current
limitations](limitations.md)).

## Receipts

**Receipt.** An official tax receipt with a number from the GPO sequence
(`GPO-` followed by digits), an issue date, the donor's name and address as
they were at issuance, and a PDF in three copies (office, donor, and
political entity). A receipt is *issued*, *cancelled*, or *void*, and can
also be flagged *lost*. Once issued, a receipt's facts never change; a
correction cancels it and issues a replacement.

**Allocation.** The link between a receipt and the contribution(s) it
covers, with an amount. A receipt's total is always the sum of its
allocations. The tool will not let the allocations against one contribution
exceed its eligible amount.

**Foreign receipt.** A receipt numbered outside the tool, such as an
EO-stock paper receipt written at an event. It can be recorded so the money
is not receipted twice, but it has no PDF.

**Address snapshot.** A frozen copy of the donor's address used on a
receipt. Later address changes never alter a receipt already issued.

## Checks and problems

**Validation rule.** An automated check against EO's rules, such as "cash
over $25" or "donor over a contribution limit." Each has a code (A1, B2,
C4, and so on). The full list is in [Work queue](work-queue.md#the-validation-rules)
and under Admin > Validation rules.

**Work item.** One problem for a human to look at, in the
[work queue](work-queue.md). Each is open, resolved, or an exception
(accepted as correct anyway). An open validation item in a space blocks
receipting for that whole space.

**Owed to EO.** Something EO has already been told that is no longer true,
such as an RTD-reported contribution that was later corrected. The tool
opens an "owed to EO" work item so the amendment is not forgotten.

## Accountability

**Reason.** Almost every change in the tool asks for a reason. It is stored
with the change in the change log, so anyone can later see why something
was done. Write it for a reader a year from now ("cheque was $80, keyed as
$100"), not for yourself today.

**Change log.** The append-only record of every change: who, when, why,
before, and after. See [Change log](change-log.md).

**Kill switch.** A single control that stops all receipt issuance at once,
as the law requires the party to be able to do. See
[Administration](administration.md#kill-switch).

## Systems around the tool

**Qomon.** The GPO's CRM, where online donations happen and contact records
live. The tool imports new transactions from Qomon and, when connected,
writes contact changes back to it.

**Elections Ontario (EO).** The regulator. Receives RTD filings, the annual
ALL and S2P2 reports (through each entity's return), and amendment forms
such as the DC-1A.
