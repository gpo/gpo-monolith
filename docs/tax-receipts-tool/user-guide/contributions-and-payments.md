---
last-reviewed: 2026-10-06
review-interval-days: 60
---

# Contributions and payments

[Back to the guide](README.md)

Contributions are the heart of the tool: every receipt, filing, and report
is built from them. This area covers how they get in, how to find them, and
how to change them before they are receipted. For changes after a receipt
or filing, see [Corrections](corrections.md).

Terms used here ([payment](concepts.md#money-and-people),
[contribution](concepts.md#money-and-people),
[entity kind](concepts.md#where-the-money-goes-two-separate-questions),
[period](concepts.md#time)) are defined in Key concepts.

## How contributions get in

There are two ways in.

### Importing from Qomon

Online donations made through Qomon are pulled in by the **Qomon import
sweep**. For each new Qomon transaction the sweep creates a payment and one
contribution, fetches the donor from Qomon if the tool has not seen them
before, and fills in the contribution's details as best it can:

- **Period** from the acceptance date.
- **Riding** from the source code when the code names one (for example
  `TSF.W.007` is riding 7); otherwise left blank and flagged.
- **Received by** is GPO for a card or pre-authorized debit payment, since
  that money comes through GPO's payment processor; otherwise GPO, flagged
  for a human to confirm.
- **Entity kind** defaults to Party and is flagged, unless Qomon says
  otherwise.

Anything the sweep could not work out confidently becomes an "Intake" item
in the [work queue](work-queue.md), so a person confirms it. Every new
contribution is then validated.

The sweep never changes a payment or contribution it has already imported.
If a transaction is later edited or deleted in Qomon, the tool opens a
**sync incident** in the work queue instead.

Today the sweep is started by a system administrator rather than on a
schedule (see [Current limitations](limitations.md)).

### Recording a payment by hand

For cheques, cash, e-transfers, and anything else that arrives outside
Qomon. Needs the *Enter payments* permission.

1. Go to **Contributions** and choose **Add payment**.
2. Pick the **donor who paid**. If they are not in the tool yet, add them
   from the picker (see [Contributors](contributors.md)).
3. Enter the **amount**, the date it was **received on**, and the
   **method**. The reference field below the method is named for it: the
   **cheque number** for a cheque, the **processor transaction ID** for a
   card or pre-authorized debit, the **transfer reference** for a bank
   transfer. It is optional, and used to match bank statements and to catch
   the same payment entered twice. Cash and in-kind payments have no
   reference, so the field is hidden for them.
4. If the payer's name differs from the donor's (a joint cheque, for
   example), enter the **payer name**.
5. Fill in the contribution: entity kind, riding (for a CA or campaign;
   type its number or part of its name), leadership contestant (for a
   leadership contribution), received by, source code, and whether the
   donor received goods or services. Only when they did can you enter a
   non-deductible amount. An unsplit contribution shows the payment amount,
   since it covers the whole payment. The form shows which **period** the
   tool will assign before you save.
6. Give a **reason** and save.

The payment and its contributions are saved together, or not at all.

### Splitting a payment across contributions

One payment can fund several contributions, for example a $500 cheque that
is $300 to the party and $200 to a riding association, or a joint cheque
from two people. On the payment form, choose **Split across more
contributions**, then give each contribution its own amount, donor, and
entity. A running total shows how much is left.

The contributions may add up to less than the payment, but never more. A
payment that is not fully attributed shows how much is left on the
contribution's detail page, with a link to **attribute the rest** later.

Once contributions are saved, changing how a payment is split is a
[correction](corrections.md), not an edit.

## Finding contributions

**Contributions** lists every contribution you are allowed to see. The
filters always shown are:

- donor name or email;
- period, picked by name;
- riding, picked by number or name;
- entity kind (pick Party or Leadership contestant for contributions with no
  riding).

Click **Show advanced filters** for the rest:

- whether it is an agency contribution;
- amount range and acceptance-date range;
- whether it has open validation findings;
- whether it has an issued receipt.

When the advanced filters are hidden, any you set still apply, and the link
shows how many are active.

Use the **column picker** to show or hide columns. Your column choices are
kept in your browser only, so they do not follow you to another computer.

Clicking a period on the [space dashboard](dashboard.md) opens this list
already filtered to that space.

## The contribution detail page

Click a contribution to see everything about it. The **Payment** and
**Contribution** sections show the same fields, in the same order, as
**Add a payment**, so a record reads the way it was entered.

- **Payment**: the donor who paid, amount, date received, method,
  reference, payer name, and note, and every other contribution on the
  same payment (so a split cheque is visible in one place). For an
  imported payment, where it came from in Qomon. **Edit** fixes a
  manual payment (see [Fixing a payment](#fixing-a-payment)); a payment
  imported from Qomon is read-only.
- **Contribution**: the donor, amount, recipient (with the derived agency
  flag), period, date accepted, received by, source code, goods and
  services, non-deductible amount, note, and the donor's address on file.
  **Edit** changes its details (see
  [Editing a contribution](#editing-a-contribution)), and **Correct** opens
  the [correction](corrections.md) dialog.
- **Work items**: every problem the tool has found on it, open or closed.
- **Allocations and receipts**: every receipt that covers it, with actions
  on each receipt (see [Corrections](corrections.md#receipt-actions)), and
  **Issue a receipt** (see
  [Issuing one receipt](issuing-receipts.md#issuing-one-receipt)).
- **Change history**: every change to it and to its payment, from the
  change log. It starts collapsed, showing when the contribution last
  changed; select **Show** to see the entries.

To change the donor's name or address, open the donor (their name is a
link) and edit the contributor there.

## Fixing a payment

Needs *Enter payments*. If a manual payment was keyed wrongly, select
**Edit** in the **Payment** section of any of its contributions. You can
change the date received, the method, the reference, the payer name, and
the note. Give a reason and save. Every contribution on the payment is
re-validated straight away.

- **The date moves its contributions.** A contribution's accepted date
  defaults to the date the payment was received, so fixing the date also
  moves every contribution still on the old date. If one of those is
  already on an issued receipt or in an RTD filing, the date fix is
  refused; use a [correction](corrections.md) instead. If the new date
  falls in another period, the tool flags the period in the work queue;
  fix it by editing the contribution.
- **The amount and the donor are not here.** Changing either moves money
  between contributions or donors, so it goes through a
  [correction](corrections.md#contribution-corrections) (**Correct the
  amount**, with **The payment itself was mis-keyed**, or **Move to
  another donor**).
- **A payment imported from Qomon is read-only.** Qomon holds the record;
  fix it there.

## Editing a contribution

Needs *Edit contribution details*. On the detail page, select **Edit** in
the **Contribution** section, change any field, give a reason, and save. The contribution is re-validated
immediately, so a fix closes its work item on its own.

Some combinations are refused: a party or leadership contribution cannot
have a riding, a CA or campaign contribution must have one, and a
leadership contribution must name an active contestant.

**Once a contribution is on an issued receipt or in an RTD filing, it can
no longer be edited** (the **Edit** button is greyed out). EO has seen it, so changing it must go through a
[correction](corrections.md), which deals with the receipt and the EO
paperwork.

## Bulk editing

To change one field on many contributions at once, such as moving a batch
into a different period:

1. In the contributions list, tick the rows (or **select all** visible
   rows).
2. In the bulk-action bar, pick the **field to change** (period, riding,
   entity kind, received by, non-deductible amount, or source code) and the
   new value.
3. Give one reason and apply.

Each row is changed and logged separately, and one row failing does not
stop the others. The result shows how many succeeded; rows that failed stay
selected so you can see why and try again. Receipted or RTD-reported rows
fail by design. A batch can hold up to 500 rows.

Bulk edit works on the rows you have ticked, not on everything matching the
filter, so page through and tick if a filter has more rows than are shown.
