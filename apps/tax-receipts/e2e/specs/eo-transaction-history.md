# EO evaluation: Transaction History

## Application Overview

Elections Ontario evaluation rows 13-19 (audit record id, new value, old value, user, date and time, task description, audit on new records). Demo surface: Admin -> Change log (/admin/change-log, heading "Change-log explorer") plus the "Change history" panel on the contributor and contribution pages. The Admin Change log is shown only to roles that read everything or administer settings or users, so `admin@` has no Admin -> Change log: a scenario that works as admin switches to sysadmin with `switchUser(page, 'sysadmin')` (tests/helpers.ts) before opening /admin/change-log. Seeded change-log rows have no actor (shown as `system`), so every scenario starts signed out, signs in with signIn(page, '<user>'), creates its own contributor and/or payment with a unique suffix (for example Date.now()) in the last name and in every reason, makes a live edit, then asserts on the entry that edit produced. Never edit seeded contributors or contributions (such as Baseline Donor). Qomon is off in e2e, so contributors stay in the tool and address text is asserted exactly.

UI facts verified while exploring (use these exact labels):
- Contributors (/contributors): button "Add a contributor" opens dialog "Add a contributor" with First name *, Last name *, Email, Contributor type (Individual), Street number, Street, City, Province (ON default), Postal code, Country (CA default), and "Reason (required)". "Add contributor" is [disabled] until required fields and a reason are filled. A full address means street number, street, city, province, postal code, and country all filled (all-or-nothing). After saving, the browser lands on /contributors/<id> and the page shows "Address: 10 Elm St, Toronto ON M5V 2T6, CA" and "Contributor id: T<n>".
- Contributor page: button "Edit contributor" opens dialog "Edit <name>" (same fields plus "Reason (required)"). "Save changes" is [disabled] until a field is changed AND a reason is typed. Bottom panel "Change history" has a "Show N change(s)" button (becomes "Hide") revealing a table with columns At, By, Reason, Changes (plus Record where entries carry a subject type, as on a contribution). Changes is a one-line summary: "Created", "Removed", or the changed field names (for example "addresses.0.city, updatedAt"). Clicking a row opens the entry dialog (role dialog) with the actor, correlation id, reason, and a table of Field, kind badge, Before, and After cells; fields are dotted paths (for example `addresses.0.city`), an absent value renders as an em dash, and unchanged fields stay hidden behind a "Show N unchanged fields" button. The helpers `openChangeEntry`, `changeField`, and `openChangeEntryWithField` in tests/helpers.ts open the dialog and find one field's row. By shows the actor display name ("Receipt Administrator" for admin@gpo.test, "Sys Admin" for sysadmin@gpo.test).
- Payments: Contributions (/contributions) -> link "Add payment" goes to /payments/new, heading "Add a payment". Fields: "Donor who paid" (type the last name, then pick the option "Plan Probe19x"-style from the dropdown), "Amount ($)" (the first Amount field; the Contribution block has its own), Received on, Method, and in the Contribution block Recipient and Period (default "Derived from the date: 2026 Annual"; choose "2025 General Election", which is period id 64), then "Reason (required)". Button "Save payment". Result: heading "Payment recorded" with link "Open the contribution", which goes to /contributions/<id>. The contribution page lists a work item "Acceptance date is outside its period's window (A1)" for period 64 with today's date; ignore it. Its "Change history" panel shows "Show 2 changes" (Payment entry and Contribution entry, same reason).
- Admin -> Change log: filters Subject type (select; options include Contact, Contribution, Period, but not Payment), Subject id, Actor user id (a user id, not an email), Correlation id, From, To; filtering is live on typing (no Apply button); button "Export CSV (for EO)" downloads `change-log-export.csv` using the active filters. Table columns: At, Subject (rendered "Contact (<id>)", "Contribution (<id>)", "Period (64)"), Actor, Reason, Changes (the same one-line summary as the record pages; click a row for the Before/After dialog). Entry id and correlation id are not shown in the table; both are in the JSON from GET /api/change-log (fields id, subjectType, subjectId, actorUserId, actorName, reason, before, after, at, correlationId; response shape { data, nextCursor }). Read them with page.request.get('/api/change-log?subjectId=<id>') after signing in (the session cookie is shared). Each contributor create and each edit has its own correlationId; a payment's Payment and Contribution entries share one.
- Admin -> Periods (/admin/periods): saving is sysadmin only (admin@ gets no change-log entry). Form "Create or edit a period": Id (EO period id), Name, Kind (select ANNUAL / GENERAL_ELECTION / BY_ELECTION), Starts at (UTC), Ends at (UTC) (datetime-local; fill like 2025-05-29T00:00), "Reason (required, recorded in the change log)", button "Save period". Saving an existing id shows "Saved. Validation re-run against every mirrored contribution." Period 64 "2025 General Election" (GENERAL_ELECTION, starts 1/27/2025, ends 5/28/2025) is used by no fixture. The stored endsAt carries the browser time zone offset (for example 2025-05-28T04:00:00.000Z), so assert the date, not the exact time of day.

General guidance for generated tests: before any click on a Save/Add button, assert toBeEnabled (or toBeDisabled where the scenario says so) and never click a disabled button. Wait for the dialog to close or the success state rather than sleeping.

## Test Scenarios

### 1. Transaction History

**Seed:** `apps/tax-receipts/e2e/tests/seed.spec.ts`

#### 1.1. Row 13: Two edits produce two distinct audit entries and a correlation id narrows to one cascade

**File:** `tests/eo/transaction-history/row-13-distinct-entries.spec.ts`

**Steps:**
  1. Mutates: creates contributor 'Audrey Trail<suffix>' and edits its address once. Reads nothing seeded. Sign in with signIn(page, 'admin'). Go to /contributors, click 'Add a contributor', fill First name 'Audrey', Last name 'Trail<suffix>', Street number '10', Street 'Elm St', City 'Toronto', Postal code 'M5V 2T6' (Province ON and Country CA default), Reason 'Row13 create <suffix>'. Assert 'Add contributor' is enabled, then click it.
    - expect: The browser lands on /contributors/<id> with heading 'Audrey Trail<suffix>' and 'Address: 10 Elm St, Toronto ON M5V 2T6, CA'. Capture <id> from the URL.
  2. Click 'Edit contributor', change Street to 'Oak Ave', fill 'Reason (required)' with 'Row13 edit <suffix>', assert 'Save changes' is enabled, click it.
    - expect: The dialog closes and the page shows 'Address: 10 Oak Ave, Toronto ON M5V 2T6, CA'.
  3. Go to /admin/change-log. Type <id> into the 'Subject id' filter.
    - expect: Exactly two rows, both with Subject 'Contact (<id>)': Reason 'Row13 edit <suffix>' (newer, first) and 'Row13 create <suffix>' (older). They are two separate rows, not one merged row.
  4. Use page.request.get('/api/change-log?subjectId=<id>') and read the data array.
    - expect: Two entries, each with a non-empty id, and the two ids differ.
    - expect: The two entries have different correlationId values.
  5. In the UI, type the correlationId of the newer entry into the 'Correlation id' filter (leave Subject id as is).
    - expect: Only one row remains, the one with Reason 'Row13 edit <suffix>'; the 'Row13 create <suffix>' row is gone.

#### 1.2. Row 13: Unique audit record ids are covered by the API tests

**File:** `tests/eo/transaction-history/row-13-unique-ids-api.spec.ts`

**Steps:**
  1. Not a browser test. The unique id on every audit record (change_log_entry.id) exists in the schema and the API JSON, not in the UI table. It is covered by apps/tax-receipts/api/src/changelog/write.test.ts and apps/tax-receipts/api/src/changelog/list.test.ts. Generate this file as a single test.skip whose title and comment cite both files. Mutates: nothing.
    - expect: The generated spec is one test.skip naming write.test.ts and list.test.ts, with no page interactions.

#### 1.3. Row 14: New value is captured in 'after' on a live edit

**File:** `tests/eo/transaction-history/row-14-new-value.spec.ts`

**Steps:**
  1. Mutates: creates contributor 'Nina Newval<suffix>' and edits its city. Sign in as admin. Add the contributor (First name 'Nina', Last name 'Newval<suffix>', Street number '10', Street 'Elm St', City 'Toronto', Postal code 'M5V 2T6', Reason 'Row14 create <suffix>'). On the new record click 'Edit contributor', change City to 'Ottawa', Reason 'Row14 new value <suffix>', assert 'Save changes' is enabled, click it.
    - expect: The contributor page shows 'Address: 10 Elm St, Ottawa ON M5V 2T6, CA'.
  2. Sign in as sysadmin (switchUser), go to /admin/change-log and type the contributor id into 'Subject id'. Find the row whose Reason is 'Row14 new value <suffix>' and click it.
    - expect: The row's Changes cell lists 'addresses.0.city'; the dialog's 'addresses.0.city' row has After 'Ottawa'.
    - expect: Reading GET /api/change-log?subjectId=<id>, the entry with that reason has after.addresses[0].city === 'Ottawa'.
  3. Open /contributors/<id> and click 'Show 2 changes' in Change history.
    - expect: The newest row has Reason 'Row14 new value <suffix>', its Changes cell lists 'addresses.0.city', and its dialog shows After 'Ottawa'.

#### 1.4. Row 15: Old value is captured in 'before' on the same entry

**File:** `tests/eo/transaction-history/row-15-old-value.spec.ts`

**Steps:**
  1. Mutates: creates contributor 'Olga Oldval<suffix>' with city 'Toronto' and edits the city to 'Hamilton'. Sign in as admin, add the contributor (Street number '10', Street 'Elm St', City 'Toronto', Postal code 'M5V 2T6', Reason 'Row15 create <suffix>'), then edit City to 'Hamilton' with Reason 'Row15 old value <suffix>' (assert 'Save changes' is enabled before clicking).
    - expect: The contributor page shows 'Address: 10 Elm St, Hamilton ON M5V 2T6, CA'.
  2. Sign in as sysadmin (switchUser), go to /admin/change-log, filter 'Subject id' = <id>, locate the row with Reason 'Row15 old value <suffix>' and click it.
    - expect: The dialog's 'addresses.0.city' row has Before 'Toronto' and After 'Hamilton'.
    - expect: Via GET /api/change-log?subjectId=<id>, that entry has before.addresses[0].city === 'Toronto' and after.addresses[0].city === 'Hamilton'.
  3. Open /contributors/<id> and click 'Show 2 changes' in Change history.
    - expect: The edit row's dialog shows the same Before 'Toronto' and After 'Hamilton'; the create row's Changes cell reads 'Created' and its dialog shows an em dash as Before for 'addresses.0.city'.

#### 1.5. Row 16: The user who made the change is captured as the admin@ user

**File:** `tests/eo/transaction-history/row-16-user.spec.ts`

**Steps:**
  1. Mutates: creates contributor 'Uma User<suffix>' and edits its postal code. Sign in as admin, add the contributor (Street number '10', Street 'Elm St', City 'Toronto', Postal code 'M5V 2T6', Reason 'Row16 create <suffix>'), then edit Postal code to 'M4M 1A1' with Reason 'Row16 user <suffix>' (assert 'Save changes' is enabled first).
    - expect: The page shows 'Address: 10 Elm St, Toronto ON M4M 1A1, CA'.
  2. Sign in as sysadmin (switchUser), go to /admin/change-log, filter 'Subject id' = <id>.
    - expect: Both rows (create and edit) show Actor 'Receipt Administrator'; neither shows 'system'.
  3. Read GET /api/change-log?subjectId=<id>, take actorUserId from the edit entry. Clear 'Subject id' and type that id into 'Actor user id'.
    - expect: The list contains the row with Reason 'Row16 user <suffix>' and every visible row has Actor 'Receipt Administrator' (no rows by other users, no 'system' rows).
  4. Still signed in as sysadmin, reload /admin/change-log and put the same admin user id in 'Actor user id'.
    - expect: The 'Row16 user <suffix>' entry is still attributed to 'Receipt Administrator', not 'Sys Admin'.

#### 1.6. Row 17: Date and time of the change are captured

**File:** `tests/eo/transaction-history/row-17-timestamp.spec.ts`

**Steps:**
  1. Mutates: creates contributor 'Tim Stamp<suffix>' and edits its street number. Sign in as admin, add the contributor (Street number '10', Street 'Elm St', City 'Toronto', Postal code 'M5V 2T6', Reason 'Row17 create <suffix>'). Record t0 = new Date() immediately before saving the edit (Street number '22', Reason 'Row17 time <suffix>', 'Save changes' enabled), and t1 right after the dialog closes.
    - expect: The page shows 'Address: 22 Elm St, Toronto ON M5V 2T6, CA'.
  2. Sign in as sysadmin (switchUser), go to /admin/change-log, filter 'Subject id' = <id>.
    - expect: The edit row's At cell is a non-empty localized date and time (for example '10/18/2026, 1:53:05 PM') on today's date.
  3. Read GET /api/change-log?subjectId=<id> and parse entry.at for each entry.
    - expect: The edit entry's at is an ISO timestamp with t0 - 5s <= at <= t1 + 5s.
    - expect: The create entry's at is earlier than the edit entry's at (the table lists newest first).
  4. Set the 'From' date filter to today's date (YYYY-MM-DD), then to tomorrow's date; separately set 'To' to yesterday's date.
    - expect: With From = today both rows remain; with From = tomorrow neither row is listed; with To = yesterday neither is listed.

#### 1.7. Row 18: A reason is mandatory and recorded as the task description

**File:** `tests/eo/transaction-history/row-18-reason-mandatory.spec.ts`

**Steps:**
  1. Mutates: creates contributor 'Rhea Reason<suffix>' and edits it. Sign in as admin, go to /contributors, click 'Add a contributor', fill First name 'Rhea' and Last name 'Reason<suffix>' but leave 'Reason (required)' blank.
    - expect: 'Add contributor' is [disabled] (assert toBeDisabled; do not click it).
  2. Fill Reason 'Row18 create <suffix>' and add the contributor. On the new record click 'Edit contributor', change City (add a full address first if the dialog needs one: Street number '10', Street 'Elm St', City 'Toronto', Postal code 'M5V 2T6') to 'London' and leave 'Reason (required)' blank.
    - expect: 'Save changes' is [disabled] (assert toBeDisabled; do not click it).
  3. Type Reason 'Row18 task <suffix>'.
    - expect: 'Save changes' becomes enabled. Click it; the dialog closes.
  4. Sign in as sysadmin (switchUser), go to /admin/change-log, filter 'Subject id' = <id>.
    - expect: The edit row's Reason cell reads exactly 'Row18 task <suffix>'; the create row's Reason reads 'Row18 create <suffix>'.

#### 1.8. Row 18: A payment cascade shares one correlation id

**File:** `tests/eo/transaction-history/row-18-correlation-cascade.spec.ts`

**Steps:**
  1. Mutates: creates contributor 'Cora Cascade<suffix>' and a $25 payment in period 64 (2025 General Election; no fixture uses it). Sign in as admin, add the contributor (Street number '10', Street 'Elm St', City 'Toronto', Postal code 'M5V 2T6', Reason 'Row18c create <suffix>'). Go to /payments/new, type 'Cascade<suffix>' in 'Donor who paid' and pick the option, set the first 'Amount ($)' to 25, set Period to '2025 General Election', Reason 'Row18c payment <suffix>', assert 'Save payment' is enabled, click it.
    - expect: Heading 'Payment recorded' with an 'Open the contribution' link.
  2. Click 'Open the contribution', then click 'Show 2 changes' in Change history.
    - expect: Two history rows, both with Reason 'Row18c payment <suffix>' (one Payment, one Contribution).
  3. Read GET /api/change-log?subjectId=<contribution id from the URL> and GET /api/change-log (filtered by actorUserId of the admin) and pick the entries with reason 'Row18c payment <suffix>'.
    - expect: The Payment entry and the Contribution entry have the same non-empty correlationId; it differs from the contributor-creation entry's correlationId.
  4. Sign in as sysadmin (switchUser), go to /admin/change-log and type that correlationId into 'Correlation id'.
    - expect: The listed rows all have Reason 'Row18c payment <suffix>' (the Contribution row at least; the Subject type select does not offer Payment); no row with Reason 'Row18c create <suffix>' is listed.
  5. With the correlation filter active, click 'Export CSV (for EO)' inside page.waitForEvent('download').
    - expect: A download named 'change-log-export.csv' starts; its text contains the correlationId and the reason 'Row18c payment <suffix>' and does not contain 'Row18c create <suffix>'.

#### 1.9. Row 19: Audit on new records - contributor creation then address edit

**File:** `tests/eo/transaction-history/row-19-new-contributor.spec.ts`

**Steps:**
  1. Mutates: creates contributor 'Carla Create<suffix>' and edits its address. Sign in as admin, go to /contributors, click 'Add a contributor', fill First name 'Carla', Last name 'Create<suffix>', Street number '10', Street 'Elm St', City 'Toronto', Postal code 'M5V 2T6', Reason 'Row19 create <suffix>', assert 'Add contributor' is enabled, click it.
    - expect: Lands on /contributors/<id> with 'Address: 10 Elm St, Toronto ON M5V 2T6, CA'.
  2. In the Change history panel click 'Show 1 change'.
    - expect: One row: By 'Receipt Administrator', Reason 'Row19 create <suffix>', Changes 'Created'. Its dialog shows an em dash as Before and the new values as After: 'name' is "Carla Create<suffix>" and 'addresses.0.street' is "Elm St".
  3. Click 'Edit contributor', change Street number to '55' and Street to 'Birch Rd', Reason 'Row19 address <suffix>', assert 'Save changes' is enabled, click it. Then click 'Show 2 changes'.
    - expect: The page shows 'Address: 55 Birch Rd, Toronto ON M5V 2T6, CA'.
    - expect: Two rows. The newest has Reason 'Row19 address <suffix>', By 'Receipt Administrator', Changes listing 'addresses.0.street' and 'addresses.0.housenumber'; its dialog shows Before "Elm St" and "10", After "Birch Rd" and "55".
  4. Sign in as sysadmin (switchUser), go to /admin/change-log and filter 'Subject id' = <id>.
    - expect: The same two Contact (<id>) entries are listed, newest first, with Actor 'Receipt Administrator'.

#### 1.10. Row 19: Audit on new records - a live payment creates a Contribution entry with before null

**File:** `tests/eo/transaction-history/row-19-new-payment.spec.ts`

**Steps:**
  1. Mutates: creates contributor 'Pablo Pay<suffix>' and a $40 payment in period 64 (no fixture uses it). Sign in as admin, add the contributor (Street number '10', Street 'Elm St', City 'Toronto', Postal code 'M5V 2T6', Reason 'Row19p create <suffix>'). Go to Contributions then click 'Add payment' (/payments/new), pick the donor, first 'Amount ($)' 40, Period '2025 General Election', Reason 'Row19 payment <suffix>', assert 'Save payment' is enabled, click it.
    - expect: Heading 'Payment recorded'.
  2. Click 'Open the contribution' and click 'Show 2 changes' in Change history. Capture the contribution id from the URL.
    - expect: Two rows with Reason 'Row19 payment <suffix>' and By 'Receipt Administrator'.
  3. Sign in as sysadmin (switchUser), go to /admin/change-log, choose Subject type 'Contribution', and type the contribution id into 'Subject id'.
    - expect: One row: Subject 'Contribution (<id>)', Actor 'Receipt Administrator', Reason 'Row19 payment <suffix>', Changes 'Created'. Its dialog is titled "Created Contribution (<id>)" and shows an em dash as Before and 4000 as After for 'amountCents'.
    - expect: GET /api/change-log?subjectId=<id> returns an entry with before === null.

#### 1.11. Row 19: Audit on new records - a period edit is logged as a Period entry

**File:** `tests/eo/transaction-history/row-19-period-edit.spec.ts`

**Steps:**
  1. Mutates: edits period 64 '2025 General Election' end date by one day and restores it in the same scenario. Period 64 is read by no fixture; the payment scenarios use it only as a period choice, not its end date. Sign in as sysadmin (admin@ cannot save periods). Go to /admin/periods.
    - expect: The table row for 64 reads '2025 General Election', GENERAL_ELECTION, 1/27/2025, 5/28/2025.
  2. In 'Create or edit a period' fill Id (EO period id) '64', Name '2025 General Election', Kind 'GENERAL_ELECTION', Starts at (UTC) '2025-01-27T00:00', Ends at (UTC) '2025-05-29T00:00', Reason (required, recorded in the change log) 'Row19 period <suffix>'. Assert 'Save period' is enabled, click it.
    - expect: Message 'Saved. Validation re-run against every mirrored contribution.' and the row for 64 now ends 5/29/2025.
  3. Go to /admin/change-log, choose Subject type 'Period', type '64' into 'Subject id'.
    - expect: The newest row shows Subject 'Period (64)', Actor 'Sys Admin', Reason 'Row19 period <suffix>'.
    - expect: Via GET /api/change-log?subjectType=Period&subjectId=64, that entry has before.endsAt on 2025-05-28 and after.endsAt on 2025-05-29 (compare the date in the browser's time zone; do not assert the exact time of day).
  4. Restore: back on /admin/periods submit the same form with Ends at (UTC) '2025-05-28T00:00' and Reason 'Row19 period restore <suffix>' ('Save period' enabled first).
    - expect: Saved message shown, row 64 ends 5/28/2025 again, and a second Period (64) entry with that reason appears in the change log.

#### 1.12. Row 19: The change log export downloads as a CSV

**File:** `tests/eo/transaction-history/row-19-export-csv.spec.ts`

**Steps:**
  1. Mutates: creates contributor 'Eve Export<suffix>' and edits its city. Sign in as admin, add the contributor (Street number '10', Street 'Elm St', City 'Toronto', Postal code 'M5V 2T6', Reason 'Row19x create <suffix>') and edit City to 'Barrie' with Reason 'Row19x edit <suffix>' (assert 'Save changes' enabled).
    - expect: The page shows 'Address: 10 Elm St, Barrie ON M5V 2T6, CA'.
  2. Sign in as sysadmin (switchUser), go to /admin/change-log, type the contributor id into 'Subject id', then click 'Export CSV (for EO)' inside page.waitForEvent('download').
    - expect: A download starts with suggested filename 'change-log-export.csv'.
  3. Read the downloaded text.
    - expect: The header row has columns at, subjectType, subjectId, actor, reason, correlationId, before, after (quoted or unquoted).
    - expect: Exactly two data rows, both with subjectType Contact and actor 'Receipt Administrator', containing the reasons 'Row19x edit <suffix>' and 'Row19x create <suffix>'; the create row's before field is empty.
