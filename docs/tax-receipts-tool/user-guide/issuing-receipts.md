---
last-reviewed: 2026-10-10
review-interval-days: 60
---

# Issuing receipts

[Back to the guide](README.md)

Issuing turns clean contributions into numbered official tax receipts, each
with a PDF. Most receipts are issued a whole [space](concepts.md#spaces) at
a time once a period closes; a single receipt can also be issued on its own.

## Who can issue

By law (Election Finances Act s. 25.1(6)) only the **party CFO** or an
authorized **CFO designate** may issue receipts. The *Issue receipts*
permission is held by the Party CFO role, and every CFO designate has it.
System administrators deliberately do not.

Issuance also stops entirely while the [kill switch](administration.md#kill-switch)
is engaged.

## Issuing a whole space

From the [space dashboard](dashboard.md), choose **Issue** on the space's
row. The issuance wizard has three steps.

### 1. Review

The tool checks the space's gate and shows a preview.

- **If anything blocks the space**, you see the list of open work items on
  its contributions, with links. One open validation item anywhere in the
  space blocks the whole space; clear them in the
  [work queue](work-queue.md) and come back.
- **If the space is clear**, you see exactly what would be issued: every
  receipt, its donor, and its amount, with totals. Nothing has been issued
  yet. This preview replaces the old "trial receipts."
- **One receipt per donor** (off by default) combines each donor's
  contributions in the space onto a single receipt, so a monthly donor
  gets one receipt for the period rather than twelve. The preview updates
  to show the combined receipts, with how many contributions each covers.
  See [Combined receipts](#combined-receipts) for what can share one.

The Review step also holds the **donor pre-check** card, for asking donors
to confirm their address and delivery preference before anything is
issued. See [Delivering receipts](delivering-receipts.md#donor-pre-check).

### 2. Generate

Enter:

- the **received-by label**, the political entity's name exactly as it
  should print on every receipt in this space (prefilled with "Green Party
  of Ontario" for a party space; for a CA or campaign, type the entity's
  name; for leadership, the contestant's name prints from their record);
- a **delivery override**, if you want to force every receipt to email or
  mail (leave it alone to use each donor's own preference, which defaults
  to mail);
- a **reason** for this run, such as "2026 annual receipts."

Choose **Generate receipts**. For each contribution with something left to
receipt (or each donor's group of contributions, with **One receipt per
donor** on), the tool takes the next receipt number, freezes the donor's
address, records the allocations, and renders the PDF in the layout chosen
under [Admin > Receipts](administration.md#receipt-layout).

Results show per row, with a link to each PDF. If a few rows fail (for
example, a donor with no address), the others still issue; fix the
failures and run Generate again, and it picks up only the stragglers.
Nothing is ever issued twice.

### 3. Deliver

Send the receipts by email and print the rest. See
[Delivering receipts](delivering-receipts.md).

## Issuing one receipt

For a single contribution, for example when a donor asks for their receipt
early. On the contribution's detail page, in **Allocations and receipts**:

1. Leave the **amount** blank to receipt everything still eligible, or
   enter a smaller amount.
2. Choose the **delivery** channel.
3. Check the **received-by label**.
4. Give a **reason** ("donor requested annual receipt") and issue.

The page tells you when there is nothing left to receipt, or when the
contribution is still waiting on its details from intake.

## What a receipt contains

- A number from the single GPO sequence (`GPO-` and digits). Numbers are
  never reused, and a cancelled receipt's number is never freed.
- The issue date, the donor's name, and their address as it was at
  issuance.
- The eligible amount, the contribution date (a range of dates on a
  [combined receipt](#combined-receipts)), and the received-by entity.
- Three copies on one page: office, donor, and political entity.
- In the contributor-type layout, the line "Contributor Type: Individual."

Once issued, a receipt's facts can never change. A mistake is fixed by a
[correction](corrections.md), which cancels it and issues a replacement.

## Combined receipts

One receipt can cover several contributions from the same donor. Each
contribution stays its own record, linked to the receipt by its own
allocation, so the receipt still shows exactly which contributions it
covers and for how much. There are two ways to issue one:

- in the issuance wizard, turn on **One receipt per donor** (see
  [Review](#1-review));
- on a [contributor's record](contributors.md), tick two or more
  contributions in **Contributions**, enter the received-by label and a
  reason, and choose **Issue one receipt**. Needs *Issue receipts*.

Contributions can share a receipt only when they agree on everything a
receipt prints or reports once: the same period, entity, riding, and
leadership contestant, the same agency status, and the same contribution
type. Monetary and goods-and-services contributions always get separate
receipts. On the contributor's record, once you tick one contribution,
only the ones that can join it stay selectable.

A combined receipt:

- prints the total of its contributions as the eligible amount;
- prints **Received on** as a range of acceptance dates, for example
  "2026-03-01 to 2026-05-02" (a single date when they were all accepted
  the same day);
- appears in the ALL report as one row with the receipt's total, dated to
  the latest acceptance date, and counts toward the donor's S2P2 total like
  any other receipt.

A contribution is never added to a receipt that has already been issued,
because its PDF would no longer match. To combine a contribution with an
existing receipt, cancel that receipt and issue a combined one. Corrections
that reissue a receipt carry every contribution it covered onto the
replacement.

## Receipts issued outside the tool

A receipt numbered outside the tool, such as an EO-stock paper receipt
handwritten at an event with no connection, can be recorded against its
contribution so the money cannot be receipted again. The tool keeps the
number as given and makes no PDF, since the paper receipt is the legal
document. This is meant to be rare, and is available through the API only
for now (see [Current limitations](limitations.md)).
