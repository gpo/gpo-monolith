---
last-reviewed: 2026-10-06
review-interval-days: 90
---

# Administration

[Back to the guide](README.md)

The **Admin** area holds the tool's configuration. Anyone signed in can
view most sections; changing them needs the permission named for each
section. Almost every change asks for a reason and is recorded in the
[change log](change-log.md).

| Section | Needs |
|---|---|
| Periods, Contribution limits, RTD holidays, Ridings, Leadership contestants, Receipts, Emails | *Manage annual settings* |
| Users, Roles | *Manage users and roles* |
| Kill switch | *Operate the issuance kill switch* |
| Validation rules, Change log | Reading only |

## Annual settings

Set these up before each year's contributions arrive. The values are data,
not code, so a change in EO's rules is an admin change, not a software
release.

### Periods

Each EO contribution period: its EO period id, kind (annual, general
election, or by-election), start and end, and for a by-election, its
riding. Contributions are assigned to a period by acceptance date, and an
election period takes priority over the annual one.

Editing a period re-runs validation on every contribution, since moving a
period boundary can put contributions outside their window (rule A1).

### Contribution limits

The limit for each bucket (party, CA, campaign, leadership,
candidate-self) per year. Add, change, or remove buckets as EO's rules
change. Rule B2 checks donors against these.

### RTD holidays

The business-day calendar for each year: the holidays the
[RTD](rtd-filings.md) 15-business-day clock skips. It is seeded with the
standard Ontario statutory holidays; review it each year.

### Ridings

The 124 ridings from EO's riding directory: number, name, and whether the
riding is active. Import an updated directory as a JSON file; re-importing
updates existing ridings rather than duplicating them. A contribution to a
CA in an inactive riding is flagged (rule A3).

### Leadership contestants

The registry of leadership contestants: name and contest. A leadership
contribution must name an active contestant, and the contestant's name
prints as "Received By" on its receipt. Contestants are never deleted.

## Users and roles

Adding users, assigning roles, CFO designates, deactivation, password
resets, and defining roles are covered in
[Accounts, roles, and access](accounts-and-access.md#managing-users-administrators).

## Kill switch

The law requires the party to be able to stop issuing receipts at once (EFA
s. 25.1(7)), for example at EO's request. **Admin > Kill switch** shows
whether issuance is enabled, and engaging or releasing it needs a reason.

While engaged:

- no receipt can be issued, reissued, or recorded, by any route;
- receipt emails and print batches are held;
- cancelling receipts and other corrections that do not issue a new
  receipt still work, so mistakes can be fixed;
- donor pre-check emails still go out.

## Receipt layout

**Admin > Receipts** chooses how receipt PDFs are drawn:

- **Legacy**: the long-standing receipt layout.
- **Contributor type**: adds "Contributor Type: Individual" on all three
  copies, as EO's evaluation asks.

The setting applies to every receipt rendered from then on (issues,
reissues, reprints, and corrections). Receipts already stored are never
re-rendered. Changing it needs a reason.

## Emails

**Admin > Emails** holds the **Send real email** switch and the email log.
See [Real email versus simulated email](delivering-receipts.md#real-email-versus-simulated-email).
The switch can only be turned on where the environment allows real
sending. In the log, a simulated email can be played a "delivered" or
"bounced" event to rehearse what happens next.

## Validation rules

A read-only reference of every [validation rule](work-queue.md#the-validation-rules),
grouped by category, showing whether each is implemented yet.

## Change log

See [Change log](change-log.md).

## Dev tools

Shown only in development builds. Includes a button to run the Qomon import
sweep by hand.
