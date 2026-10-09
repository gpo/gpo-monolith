---
last-reviewed: 2026-10-06
review-interval-days: 60
---

# Corrections

[Back to the guide](README.md)

Corrections fix a contribution or receipt **after** it has been receipted
or reported to EO. Before that point, just
[edit the contribution](contributions-and-payments.md#editing-a-contribution).

Under the old process every correction was a manual runbook of five to ten
steps. In the tool, each is one guarded action: you choose what is wrong,
the tool shows everything that will follow from it, and one commit does it
all, logged under a single entry in the change log.

## How corrections work

- **Nothing is edited in place.** A receipted or reported contribution is
  *superseded*: the old row is closed and kept, and new rows replace it on
  the same payment. An issued receipt is *cancelled* (its number is kept,
  never reused) and a replacement issued.
- **Preview first.** Every contribution correction shows its full effect
  before anything is written, and lists anything that blocks it.
- **EO is never forgotten.** If the change touches anything EO has already
  seen, the tool queues the follow-up in the
  [Owed to EO](work-queue.md#the-five-queues) queue.

## Contribution corrections

On a contribution's detail page, open **Correct this contribution** and
pick an action:

| Action | Use it when |
|---|---|
| **Correct the amount** | The contribution amount was wrong. If the payment itself was mis-keyed (the cheque was $80, entered as $100), tick **The payment itself was mis-keyed** to correct the payment too. |
| **Move to another donor** | The wrong person was credited, for example a gift from one spouse recorded under the other. |
| **Split between donors or entities** | One contribution should have been several, for example half to the party and half to a CA, or shared between two people. The parts must add up to the whole contribution. |
| **Reallocate to another entity (over-limit)** | A donor is over a contribution limit and the excess should go to an entity where they have room. The tool proposes a reallocation. Needs *Submit EO filings* (the party CFO or a designate) as filer sign-off. |
| **Refund** | The money is being returned, for example to an out-of-province donor. |
| **Merge this donor into another contact** | Two contact records are the same person. If anything was RTD-reported, you must record the evidence that they are the same person. |

Then:

1. Fill in what the action asks for (new amount, new donor, entity and
   riding, the received-by label for any new receipt, and so on).
2. Give a **reason**.
3. **Preview.** The preview lists every contribution that will be
   superseded or refunded, every receipt that will be cancelled, every
   replacement receipt that will be issued, and every item that will be
   owed to EO. It also lists **blockers**, such as the kill switch being
   engaged, a donor with no printable address, or a replacement with no
   period.
4. **Commit correction.** The tool does exactly what was previewed.

### What one commit does

- Supersedes or refunds the contributions, and corrects the payment if
  asked.
- Cancels every issued receipt covering them, storing a copy of the
  original PDF watermarked "CANCELLED."
- Issues replacements: the donor's own receipt is reissued carrying the
  contributions that did not change, and anything moved to another donor or
  entity gets its own new receipt. Each replacement says which receipt it
  cancels and replaces.
- Queues a **DC-1A** amendment for anything that was RTD-reported, and a
  **return note** for anything inside an entity report already filed.
- Closes open validation items on the retired rows and validates the
  replacements.

Who can run them: *Correct contributions*, plus *Correct receipts* when a
receipt will be cancelled or issued. A riding-limited user can correct only
their own ridings.

## Receipt actions

Each receipt in a contribution's **Allocations and receipts** panel has a
menu of actions (needs *Correct receipts*, which the party CFO, CFO
designates, and receipt administrators hold):

| Action | What it does | Receipt cancelled? |
|---|---|---|
| **Cancel this receipt** | Cancels it and stores a watermarked cancellation notice. The amount can be receipted again. If it was RTD-reported, a DC-1A is queued. | Yes |
| **Reissue this receipt** | Cancels it and issues a replacement from current data (for example, after an address fix), marked as cancelling and replacing the original. | Yes |
| **Reprint as a lost-receipt copy** | Reprints the receipt unchanged, stamped COPY, and flags the original lost. The receipt stays valid. | No |
| **Fix the spelling of the donor name** | Regenerates the receipt with a corrected spelling. Only a small spelling fix of the same person qualifies (a few characters); anything bigger is a reissue. | No |

Cancelling is allowed while the kill switch is engaged (so mistakes can
still be fixed); reissuing is not, since it issues a new number.

## After a correction

- **Donor notices.** The cancellation notice and replacement receipt are
  stored with the receipt. They are not yet emailed automatically; send
  them through the normal delivery process or by hand (see
  [Current limitations](limitations.md)).
- **Owed to EO.** Work through the Owed to EO queue: send EO the DC-1A or
  return note, then resolve the item. The tool can produce the DC-1A form
  and lists it on the [RTD filings](rtd-filings.md) screen, but there is no
  button for it yet (see [Current limitations](limitations.md)).
- **Entity reports.** Any entity report that included a changed receipt
  shows as [dirty](entity-reports.md#dirty-reports), so you know exactly
  which ones to regenerate and re-send.
- **Qomon.** After a merge, merge the contacts in Qomon too.
