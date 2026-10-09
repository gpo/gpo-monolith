---
last-reviewed: 2026-10-06
review-interval-days: 60
---

# Work queue

[Back to the guide](README.md)

The work queue holds every problem the tool has found that needs a person.
The tool checks contributions continuously, so problems show up the day
they arrive rather than in a year-end pull. Clearing the queue is what
makes a space ready to receipt.

## The five queues

| Tab | What lands here | Typical action |
|---|---|---|
| **Validation** | A contribution breaks one of EO's rules, or the tool could not work out one of its details on import ("Intake" items) | Fix the contribution or donor; or record an exception if it is correct |
| **Diff queue** | Reserved for a receipted or reported contribution that changed from outside a correction. Today contributions cannot change that way, so this tab stays empty | Run the right [correction](corrections.md) |
| **Owed to EO** | Something EO was told is no longer true, after a correction: an RTD amendment (DC-1A) or a note for a filed return | Send EO the amendment, then resolve |
| **Sync incidents** | A transaction already imported was changed or deleted in Qomon | Decide whether the tool's copy needs a correction |
| **Delivery** | A receipt email bounced or could not be sent, so the receipt was switched to mail | Check the donor's address; the item closes when the print batch is marked mailed |

Each row shows the subject (click through to the contribution), the donor,
the rule, when it was opened, its due date if any, and its status.

## Resolving an item

Needs *Resolve work items*. Each open item offers two ways to close it, and
both need a note of at least three characters:

- **Resolve**: the problem is dealt with.
- **Except**: the tool's concern is understood and the contribution is
  correct as it stands (for example, a "possible duplicate" that is really
  two separate gifts). The note is your justification, kept in the change
  log.

Usually the better path is to fix the underlying data. Validation runs
again whenever a contribution or its donor is edited, and an item whose
problem has gone away **closes on its own**.

Things to know:

- If you resolve a validation item but the problem is still there, the
  next validation run **reopens** it.
- An exception lasts until the end of the calendar year. If the rule still
  fires in the new year, the item reopens, so each year's exceptions are a
  fresh decision.
- An open validation item on any contribution in a space **blocks
  receipting for the whole space** (see [Issuing receipts](issuing-receipts.md)).

## The validation rules

Each rule has a code. Rules marked **EO** are ones Elections Ontario's
evaluation specifically expects the tool to flag. Admin > Validation rules
lists every rule and whether it is implemented yet.

**A: the contribution itself**

| Rule | Flags |
|---|---|
| A1 | Acceptance date is outside its period's window |
| A2 | Riding or entity kind is invalid for this contribution (for example, a campaign contribution outside an election, or a leadership contribution with no contestant) |
| A3 | The entity is not active with EO for this period (for example, a defunct riding) |
| A4 | Received-by does not match how the money arrived (a processor payment must be GPO) |
| A5 | The non-deductible amount leaves nothing eligible |
| A6 | Possible duplicate contribution (same donor, amount, and entity within three days, or the same processor reference). **EO** |
| A7 | The source code's riding disagrees with the contribution's riding |
| A8 | Cash over the $25 limit |

**B: the donor**

| Rule | Flags |
|---|---|
| B1 | Out-of-province address (not eligible). **EO** |
| B2 | Over a contribution limit. **EO** |
| B3 | Anonymous or unidentifiable donor |
| B4 | Possible duplicate donor record (same email). **EO** |

**C: what prints on the receipt**

| Rule | Flags |
|---|---|
| C1 | Incomplete address |
| C2 | A comma in the address (EO's file format does not allow one) |
| C3 | Malformed or non-Ontario postal code |
| C4 | A name that cannot go on a receipt: an initial only, a joint name ("June and John Smith"), or "Anonymous" |
| C5 | No address snapshot for the receipt's period |

**Intake items** say which detail could not be worked out on import:
period, riding, entity kind, or received by. They close when a person sets
or confirms the field, and are never reopened by validation.

Rules A9 (goods-and-services invoice) and B5 (payer name on a cheque) are
listed but not implemented yet: the tool has no data to check them against yet.

The same rules are re-checked at the points where they matter most: before
an [RTD filing](rtd-filings.md) is prepared or confirmed sent, before
[receipts are issued](issuing-receipts.md), and before an
[entity report](entity-reports.md) is generated.
