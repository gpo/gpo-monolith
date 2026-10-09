---
last-reviewed: 2026-10-06
review-interval-days: 90
---

# Accounts, roles, and access

[Back to the guide](README.md)

## Signing in

Sign in with your email address and password. Until you sign in, the tool
shows only the sign-in form. The one page that works without signing in is
the donor pre-check page that donors reach from an emailed link (see
[Delivering receipts](delivering-receipts.md#donor-pre-check)).

## Your own account

Open the account menu (your initials, top right):

- **Dark mode** switches the colour scheme.
- **Edit profile** changes your name and email. Changing your email needs
  your current password, because your email is your sign-in name.
- **Change password** needs your current password. Changing it signs you out
  of every other browser where you are signed in.
- **Sign out.**

## Roles and permissions

What you can do depends on your **role**. A role is a named set of
**permissions**, and each user has exactly one role. Every signed-in user
can read the operational screens (contributions, receipts, the work queue,
filings, reports, periods, and limits); permissions add the ability to
change things.

### The permissions

| Group | Permission | Lets you |
|---|---|---|
| System | Full system access | Everything, including functions added later. System administrators only. |
| System | Manage users and roles | Create and edit users, assign roles, define roles. |
| System | Manage annual settings | Edit periods, contribution limits, the RTD holiday calendar, ridings, and leadership contestants; use the email tools. |
| Records | Read all records | Read everything, including payments, reconciliation, and EO forms. |
| Contributions | Enter payments | Record manual payments and their contributions. |
| Contributions | Add and edit contributors | Add contributors and edit names, emails, and addresses. |
| Contributions | Edit contribution details | Edit period, entity, riding, source code, and similar; send donor pre-checks. |
| Contributions | Correct contributions | Run correction actions on contributions. |
| Work queue | Create work items | Raise items on the queue by hand. |
| Work queue | Resolve work items | Resolve items or record exceptions. |
| Receipts | Issue receipts | Issue, reissue, and deliver receipts. By law, only the party CFO or an authorized designate. |
| Receipts | Correct receipts | Cancel, mark lost, reprint, and run corrections that replace a receipt. |
| Receipts | Operate the issuance kill switch | Stop and restart all issuance. |
| Reconciliation | Reconcile deposits | Match contributions to deposits (no screen yet). |
| Reporting | Generate entity reports | Generate ALL and S2P2 files. |
| Reporting | Share entity reports | Mark a report as sent to a CFO. |
| Reporting | Prepare EO filings | Prepare RTD filings and EO forms. |
| Reporting | Submit EO filings | Confirm filings as sent to EO; approve over-limit reallocations. |

### The roles the tool ships with

| Role | Typical work |
|---|---|
| System administrator | Configuration and user administration. Holds full access. This role cannot be edited or deleted. |
| Party CFO | The legal issuer of receipts; files with EO. |
| Receipt administrator | Day-to-day entry, fixes, and corrections. Cannot issue receipts. |
| Rules authority | Eligibility calls, moves between entities, non-deductible amounts. |
| Bookkeeper | Reconciliation, S2P2, auditor questions. |
| Filer | Prepares and submits reports and forms to EO. |
| Process owner | Oversight: reads everything, including who did what. |
| Organizer | Liaison with riding and campaign CFOs; shares entity reports. |
| Riding or campaign CFO | External CFO; reads only their own riding(s). |
| Read only | Reads the operational screens; changes nothing. |

New users get **Read only** unless given another role.

### CFO designates

A user marked **CFO designate** may issue and correct receipts and submit
filings on the party CFO's authority, whatever their role. This is how the
law's "or an authorized designate" is recorded. Being a designate does not
grant the contribution correction actions.

### Riding access

A user can be limited to particular ridings. A riding-limited user sees
party-level contributions plus contributions in their granted ridings, and
nothing else; a contribution outside their ridings reads as "not found."
Riding grants are currently set through the API, not the Users screen (see
[Current limitations](limitations.md)).

## Managing users (administrators)

Under **Admin > Users** (needs *Manage users and roles*):

- **Add a user** with a name, email, role, and a temporary password of at
  least 12 characters.
- **Change a user's role** from the inline role picker.
- **Mark a user as a CFO designate.**
- **Deactivate** a user. Accounts are never deleted, so the change log can
  always name who did something.
- **Edit a user's name or email**, or **reset their password**. A reset
  signs that user out everywhere.

Every user change is recorded in the change log (never the password
itself).

## Managing roles (administrators)

Under **Admin > Roles** (needs *Manage users and roles*), create a role,
name it, and tick the permissions it grants. Built-in roles can be edited
but not deleted, and the System administrator role is locked. Role changes
take effect on each affected user's next action; nobody needs to sign out.
