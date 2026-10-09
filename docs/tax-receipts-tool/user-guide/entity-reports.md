---
last-reviewed: 2026-10-06
review-interval-days: 60
---

# Entity reports

[Back to the guide](README.md)

After a year or election period, each political entity's annual return to
EO needs two files built from its receipts:

- **ALL**: every receipt for the entity in the period, at any status
  (issued, cancelled, void, or lost), one row each.
- **S2P2** (Schedule 2, Part 2): one row per contributor whose issued
  receipts to the entity total **over $200** in the period.

The tool generates both per [space](concepts.md#spaces), checks them before
they are produced, and tells you when one has gone out of date.

## Generating a report

From the [space dashboard](dashboard.md), choose **Reports** on the space's
row. Needs *Generate entity reports* (party CFO, bookkeeper, or filer).

1. In **Generate a report**, choose **ALL** or **S2P2**.
2. Enter the **political entity label**, the entity's name as it should
   appear in the file.
3. Give a reason and generate.

Before writing anything, the tool runs EO's export checks on every receipt
in scope: each must map to a valid EO entity for its period, and each
acceptance date must still fall inside its period (a period edited after
issuance can break this). If any fail, generation is **blocked** and the
failing rows are named; nothing is produced until they are fixed.

If no contributor clears $200, an S2P2 is not produced at all, which is what
EO expects.

Each generated report keeps a snapshot of exactly the rows it contained.
**Download** the CSV from the report list.

## Dirty reports

Every time you open the screen, the tool rebuilds each report's rows from
current data and compares them with the snapshot. Each report shows one of:

| Status | Means |
|---|---|
| **Clean** | Nothing in the report has changed since it was generated |
| **Dirty, changed since generated** | At least one row would now be different. Expand the report to see exactly which rows and fields changed, with old and new values. |
| **Export gate blocked** | The report could no longer be generated as it stands |
| **Not checked** | The report was not compared (combined reports) |

This replaces the old practice of re-sending every report to be safe:
regenerate and re-send only the dirty ones.

## Sending to the entity's CFO

After sending a report to the riding or campaign CFO, choose **Mark sent**
on it (needs *Share entity reports*: party CFO, filer, or organizer). The
list then shows **Sent to CFO** instead of **Not sent**.

## What the files contain

The columns follow EO's published specifications. Notable points:

- The ALL file uses EO's 21-column specification, including
  `General_Meetings` (always `N`).
- Receipt status files as `I` (issued) or `C` (cancelled or void), and
  `L` for a receipt marked lost.
- `Agency_Contribution` is `Y` when GPO received money directed to another
  entity. It is derived, never typed in.
- Leadership contributions file with entity type `LC` and the
  contestant's name, and S2P2 aggregates per contestant.
- The donor's name comes from their current contact record, so a spelling
  fix reaches EO even though the receipt itself is never edited.
