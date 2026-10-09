---
last-reviewed: 2026-10-06
review-interval-days: 60
---

# RTD filings

[Back to the guide](README.md)

Real-time disclosure (RTD, Election Finances Act s. 34.1) tells EO about
contributors to the party during the year, not just at year end. The
**RTD filings** screen builds each filing, keeps the file, and records
exactly what EO has been sent.

## The rule

- RTD covers **monetary contributions to the party** (entity kind Party),
  received and not goods or services.
- A deposit is disclosed once the contributor's total for the **calendar
  year** goes **over $200** (exactly $200 does not count). From that
  deposit on, every further deposit from them that year is its own row.
- Each row carries the contributor's **running total** for the year as of
  that deposit.
- Each deposit must be filed within **15 business days** of being received.
  Business days skip weekends and the holidays set under
  [Admin > RTD holidays](administration.md#annual-settings).
- A filing contains only rows not already filed. Already-filed deposits
  still count toward the running total.

For example: $150, then $100, then $75 from one donor in 2026. The first
stays under $200 and is not a row. The second takes the total to $250 and
is a row (aggregate $250). The third is a row too (aggregate $325).

## Building and sending a filing

Preparing needs *Prepare EO filings* (the Filer role) or a CFO designate.
Confirming sent needs *Submit EO filings* (Filer, party CFO) or a CFO
designate.

1. **Pick the year.** The **draft builder** shows every unfiled deposit that
   should be disclosed: contributor, deposit date, amount, running
   aggregate, its deadline (days left, or **Overdue**), and its **gate**
   status.
2. **Check the gate.** A row with an open A1 (period window), B1 (out of
   province), B2 (over limit), or C4 (unprintable name) item in the
   [work queue](work-queue.md) cannot be filed until that item is dealt
   with.
3. **Select rows.** Tick rows, or **select all eligible rows**.
4. **Prepare the filing.** Enter the **CFO name** (printed on the filing),
   choose the **format** (CSV or pipe-delimited), give a reason, and choose
   **Prepare filing**. The tool creates the filing, named
   `2026_RTD_8_MMDDYYYYHHMM` in EO's convention, renders the file, and
   locks the included contributions against casual edits.
5. **Download** the file from the filings list and email it to EO.
6. **Confirm sent.** Back in the filings list, choose **Confirm sent** and
   give a reason such as "emailed to EO 2026-03-06." Only now does the tool
   treat the rows as reported to EO. It re-checks the gate first, and
   refuses if a row has picked up a blocking problem since you prepared it.

The filings list shows each filing's name, kind (Initial or DC-1A), when it
was generated, its row count, and whether it has been sent.

## When a reported contribution changes

Once a contribution has been reported, it can only change through a
[correction](corrections.md). The correction opens an **Owed to EO** item
for a **DC-1A** amendment, which references the original filing. DC-1A
amendments appear in the filings list alongside initial filings. See
[Current limitations](limitations.md) for how a DC-1A is produced today.

## Things to know

- A filing's file is kept as it was sent, with a fingerprint of its
  contents, so "what did we tell EO?" always has an exact answer.
- RTD runs on its own clock, independent of receipting. A space can be
  months from issuing receipts while its party deposits are being filed.
- A deposit received in December and filed in January belongs to the year
  it was received.
