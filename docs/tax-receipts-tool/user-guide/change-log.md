---
last-reviewed: 2026-10-06
review-interval-days: 90
---

# Change log

[Back to the guide](README.md)

The change log is the tool's audit trail. Every change to anything that
matters (payments, contributions, contacts, receipts, filings, reports,
work items, settings, users, and roles) writes an entry recording:

- **who** made the change (or "system," for automatic changes such as an
  import);
- **when**;
- **why**: the reason they typed;
- **what** changed: the record's type and id, and its contents **before**
  and **after**.

The entry is written in the same step as the change. If the entry cannot be
written, the change does not happen. Entries are never edited or deleted.

## Viewing it

Go to **Admin > Change log**. Any signed-in user can view it. Filter by:

| Filter | Use it to |
|---|---|
| Subject type | See only changes to, say, receipts or contacts |
| Subject id | See the full history of one record |
| Actor user id | See everything one person did |
| Correlation id | See every change made by one action together (a correction that cancelled two receipts and issued three shares one correlation id) |
| From / To | Limit to a date range |

Each row shows the before and after contents. A record's own history also
appears on its page: the **Change history** panel on a contribution or a
contributor.

## Exporting for EO

**Export CSV (for EO)** downloads the entries matching the current filters,
up to 50,000 rows, one row per entry with before and after included.

## Why it matters

EO's evaluation checks that the system can show who changed what and why.
More practically, it means "what did we tell EO, and why?" always has an
answer, and a mistake can be traced to its source.
