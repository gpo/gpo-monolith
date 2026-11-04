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
filings, periods, and limits); permissions add the ability to change things.
Entity reports are the exception: seeing them is itself a permission (*View
entity reports*), so access to them can be limited to privileged users.

### The permissions

| Group | Permission | Lets you |
|---|---|---|
| System | Full system access | Everything, including functions added later. System administrators only. |
| System | Manage users and roles | Create and edit users, assign roles, define roles. |
| System | Manage annual settings | Edit periods, contribution limits, the RTD holiday calendar, ridings, and leadership contestants; use the email tools. |
| Records | Read all records | Read everything, including payments, reconciliation, EO forms, and entity reports. |
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
| Reporting | View entity reports | List generated ALL and S2P2 files and download them. |
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
| Riding or campaign CFO | External CFO; reads only their own riding(s), including their entity reports. |
| Read only | Reads the operational screens; changes nothing. |

New users get **Read only** unless given another role.

### CFO designates

A user marked **CFO designate** may issue and correct receipts and submit
filings on the party CFO's authority, whatever their role. This is how the
law's "or an authorized designate" is recorded. Being a designate does not
grant the contribution correction actions.

### Riding access

Riding access is set per user, separately from their role. A user either
sees **all ridings** (central staff) or is limited to their **granted
ridings**. A riding-limited user sees party-level contributions plus
contributions in their granted ridings, and nothing else; a contribution
outside their ridings reads as "not found." The Users table shows each
user's access as All, the granted riding numbers, or Party only.

New users have no riding access until it is given: with neither All ridings
nor any grant, they see party-level contributions only, whatever their
role. Tick **All ridings** for central staff such as the Filer or
bookkeeper.

## Managing users (administrators)

Under **Admin > Users** (needs *Manage users and roles*):

- **Add a user** with the **New user** button, giving a name, email, role,
  riding access, and a temporary password of at least 12 characters.
- **Edit a user** to change their name, email, role, riding access, or
  active status.
  Every edit needs a reason. Deactivating stops a user signing in; accounts
  are never deleted, so the change log can always name who did something.
- **Mark a user as a CFO designate.**
- **Reset a user's password.** A reset signs that user out of every
  browser, so anyone using the old password loses access straight away.

Every user change is recorded in the change log (never the password
itself).

## Managing roles (administrators)

Under **Admin > Roles** (needs *Manage users and roles*), create a role,
name it, and tick the permissions it grants. Built-in roles can be edited
but not deleted, and the System administrator role is locked. Role changes
take effect on each affected user's next action; nobody needs to sign out.

Only a user who holds *Full system access* can hand it out or take it away:
create or edit a role so it gains or loses that permission, give a user a
role that holds it, or move a user off such a role. *Manage users and roles*
alone is refused, so it cannot be used to grant itself everything.
