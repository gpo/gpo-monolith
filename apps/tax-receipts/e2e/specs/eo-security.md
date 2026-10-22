# EO evaluation: Security

## Application Overview

Elections Ontario evaluation checklist, Security section (rows 3 to 12): sign-in, user accounts, roles and permissions, deactivation, and password changes in the GPO Tax Receipts tool (web http://localhost:5174, api :3100). Tests run serially against one shared database seeded once per run. Seeded logins (sysadmin, cfo, admin, rules, books, filer, readonly @gpo.test, password change-me-please-12345) are never edited, deactivated, renamed, or reset; every scenario that changes a user creates a fresh one as sysadmin with a unique email like e2e-<purpose>-<suffix>@gpo.test (suffix = Date.now() or random). Custom role names are unique (suffix). Every scenario starts signed out; sign in with signIn(page, '<user>') from tests/helpers.ts. For a created user, sign in with a local helper that fills Email, Password, and clicks 'Sign in' (signIn only accepts seeded names). Two-browser steps use two browser contexts in one test (browser.newContext()). UI notes from exploration: Admin (/admin) lists Users (/admin/users), Roles (/admin/roles), Change log (/admin/change-log, 'Subject type' dropdown with 'User' and 'Role'). New user dialog fields: Name, 'Email (used to sign in)', 'Temporary password' (12+ chars), Role (select), button 'Create user'. Edit user dialog (per-row 'Edit' button) fields: Name, Email, Role select, checkbox 'Active (inactive users cannot sign in)', 'Reason (required)', button 'Save'. Per-row 'Reset password' opens 'Reset password: <name>' with 'Temporary password (12+ chars)', 'Reason (required)', button 'Reset password'. Role and active status are changed in the Edit dialog, not by an inline control on the row. Account menu (button 'Account menu') has menu items 'Edit profile', 'Change password', 'Sign out'. Change password dialog fields: 'Current password', 'New password', 'Confirm new password', button 'Change password'. New role dialog: Name, Description, permission checkboxes by label, 'Reason for this change (required)', button 'Create role'. 'Generate' (button on Entity reports page, reached from the space dashboard 'Reports' link) needs 'Generate entity reports'; the dashboard 'Reports' link needs 'View entity reports' or 'Generate entity reports'; 'Mark sent' (Share) needs 'Share entity reports'; issuing is the 'Generate receipts' button on the Issue page (dashboard 'Issue' link), disabled with an alert 'Only the party CFO (or an authorized designate) may issue receipts (s. 25.1(6)).' for users without 'Issue receipts'.

## Test Scenarios

### 1. Security

**Seed:** `apps/tax-receipts/e2e/tests/seed.spec.ts`

#### 1.1. Row 3: Sign-in form is required and a bad password is refused

**File:** `tests/eo/security/row-03-sign-in-required.spec.ts`

**Steps:**
  1. Mutates: nothing (reads seeded sysadmin login only). Open http://localhost:5174/ signed out.
    - expect: The 'Sign in' heading with Email and Password fields and a 'Sign in' button is shown; no navigation or app data is visible
  2. Navigate directly to http://localhost:5174/admin/users and /contributions while signed out.
    - expect: The sign-in form is shown instead of the page content
  3. Enter sysadmin@gpo.test with a wrong password (e.g. 'wrong-password-123456') and click 'Sign in'.
    - expect: An error is shown, the 'Sign in' heading remains, and the user is not signed in
  4. Leave both fields empty and click 'Sign in'.
    - expect: Sign-in is refused (validation message or error); still on the sign-in form
  5. Enter sysadmin@gpo.test with the correct password change-me-please-12345 and click 'Sign in'.
    - expect: The 'Sign in' heading disappears and the app navigation (Contributions, Contributors, Admin, Account menu) is shown

#### 1.2. Row 4: Admin creates a user account

**File:** `tests/eo/security/row-04-admin-creates-user.spec.ts`

**Steps:**
  1. Mutates: creates user 'E2E Created <suffix>' (e2e-created-<suffix>@gpo.test). Sign in as sysadmin and open Admin then Users (/admin/users).
    - expect: The 'Users & roles' table lists Name, Email, Role, CFO designate, Status; a 'New user' button is shown
  2. Click 'New user'. Observe the 'Create user' button, then enter Name 'E2E Created <suffix>', Email 'e2e-created-<suffix>@gpo.test', Temporary password 'short' (5 chars).
    - expect: 'Create user' is disabled and the helper text says 'At least 12 characters (5 so far)'
  3. Replace the Temporary password with 'created-pass-12345', choose Role 'Read only' in the Role select, and click 'Create user'.
    - expect: The dialog closes and the table now shows a row 'E2E Created <suffix>' with that email, role 'Read only', and status 'Active'
  4. Click the Account menu then 'Sign out' and sign in at /login with the new email and password 'created-pass-12345'.
    - expect: Sign-in succeeds for the new user; the Admin link is absent or /admin/users is not manageable (no 'New user' button) since the role is Read only

#### 1.3. Row 5: Admin edits a user and the User change-log entry shows before and after

**File:** `tests/eo/security/row-05-admin-edits-user.spec.ts`

**Steps:**
  1. Mutates: creates user 'E2E Editable <suffix>', then renames it and changes its email. Sign in as sysadmin; create the user at Admin, Users, 'New user' (role Read only, password 'editable-pass-12345').
    - expect: The new user row appears in the Users table
  2. Click 'Edit' on that row. Observe that 'Save' is disabled. Change Name to 'E2E Renamed <suffix>' and Email to 'e2e-renamed-<suffix>@gpo.test' but leave 'Reason (required)' empty.
    - expect: 'Save' stays disabled until a reason is entered
  3. Enter Reason 'Fix name and email for audit demo' and click 'Save'.
    - expect: The dialog closes and the row shows the new name and email
  4. Open Admin then Change log (/admin/change-log), choose Subject type 'User' and look at the newest row for that user.
    - expect: The row shows actor 'Sys Admin', reason 'Fix name and email for audit demo', a Before value containing the old name and email, and an After value containing the new name and email
  5. Sign out, then sign in as the renamed user using the new email. Open Account menu then 'Edit profile'; change Name to 'E2E Self Edited <suffix>' only and save.
    - expect: The name saves without asking for a current password; the Account menu shows the new name
  6. Open Account menu then 'Edit profile' again, change Email to 'e2e-self-<suffix>@gpo.test'.
    - expect: A 'Current password' field is required; saving with a wrong current password is refused with an error
  7. Enter the correct current password 'editable-pass-12345' and save. Sign out and sign in with the new email.
    - expect: The email change saves and sign-in works with the new email; as sysadmin the Change log (subject 'User') shows entries for both self edits with the user as actor

#### 1.4. Row 6: Users are listed distinctly and duplicates are kept apart

**File:** `tests/eo/security/row-06-users-distinct.spec.ts`

**Steps:**
  1. Mutates: creates two users with the same display name 'E2E Twin <suffix>' (emails e2e-twin-a-<suffix>@gpo.test and e2e-twin-b-<suffix>@gpo.test). Sign in as sysadmin and create both via 'New user' with the identical Name.
    - expect: Both are created and appear as two separate rows in the Users table, distinguished by email
  2. Try to create a third user with Email e2e-twin-a-<suffix>@gpo.test (already in use) and Name 'E2E Twin Dupe <suffix>'.
    - expect: Creation is refused with an error shown in the dialog (email already in use) and no new row appears
  3. Sign out; sign in as e2e-twin-b-<suffix>@gpo.test, open Account menu, then 'Edit profile', change the name to 'E2E Twin B Edited <suffix>' and save.
    - expect: The save succeeds
  4. Sign out and sign in as sysadmin. Open Admin then Change log, Subject type 'User', and find the entry for that edit.
    - expect: The Actor column shows 'E2E Twin B Edited <suffix>' (not the other twin), and the subject id matches user B; user A's row in Admin, Users still shows the name 'E2E Twin <suffix>'

#### 1.5. Row 6: Unique user ids are covered by the API tests

**File:** `tests/eo/security/row-06-unique-user-id.spec.ts`

**Steps:**
  1. This is not a browser test. app_user.id (cuid) and its use as the FK on change_log_entry.actor_user_id, payment.created_by_user_id, and others exist only in the schema and are covered by apps/tax-receipts/api/src/routes/users.test.ts and apps/tax-receipts/api/src/auth/auth.test.ts. Write this as a test.skip with that note and no browser steps.
    - expect: The spec is a test.skip whose title and note point to those two API test files

#### 1.6. Row 7: Admin creates a new role and it appears in the change log

**File:** `tests/eo/security/row-07-admin-creates-role.spec.ts`

**Steps:**
  1. Mutates: creates role 'Riding Auditor <suffix>'. Sign in as sysadmin and open Admin then Roles (/admin/roles).
    - expect: The table lists ten roles: Bookkeeper, Filer, Organizer, Party CFO, Process owner, Read only, Receipt administrator, Riding or campaign CFO, Rules authority (each marked 'Built-in'), and System administrator (marked 'Locked')
  2. Click 'New role'. Enter Name 'Riding Auditor <suffix>', Description 'Reads records for audit', tick 'Read all records'. Observe 'Create role' while Reason is empty.
    - expect: 'Create role' is disabled until 'Reason for this change (required)' has text
  3. Enter Reason 'Create auditor role for EO demo' and click 'Create role'.
    - expect: The dialog closes; the roles table lists the new role with its description and 'Read all records', with 0 users, alongside the ten built-in roles
  4. Open Admin then Change log, choose Subject type 'Role'.
    - expect: The newest row shows actor 'Sys Admin', reason 'Create auditor role for EO demo', an empty or null Before, and an After value containing the role name and the permission key for 'Read all records'
  5. Try to create another role with the same name 'Riding Auditor <suffix>'.
    - expect: Creation is refused with an error and no duplicate row appears

#### 1.7. Row 8: Functions assigned to a role take effect live, and System administrator is locked

**File:** `tests/eo/security/row-08-role-functions.spec.ts`

**Steps:**
  1. Mutates: creates role 'E2E Report Role <suffix>', user 'E2E Reporter <suffix>' (e2e-reporter-<suffix>@gpo.test), and one ALL entity report in the '2025 Annual / Party (province-wide)' space (entity reports are append-only; no other scenario depends on that space having no reports). Sign in as sysadmin in context A. Create the role with permissions 'Read all records' and 'Generate entity reports' only, reason 'Reporter role'.
    - expect: The role appears in Admin, Roles listing exactly those two permissions
  2. In Admin, Users create user 'E2E Reporter <suffix>' with the new role and password 'reporter-pass-12345'.
    - expect: The user row shows the custom role
  3. In a second browser context B, sign in as the new user. On the home spaces table click 'Reports' on the '2025 Annual' / 'Party (province-wide)' row.
    - expect: 'Entity reports' page loads with the 'Generate' button enabled once a reason is entered; the 'Only the party CFO, a designate, bookkeeper, or filer may generate reports.' alert is absent
  4. In B enter Reason 'Reporter generate' and click 'Generate' (report kind ALL). Then go back to the spaces table and click 'Issue' on the same row and proceed to the 'Generate' step.
    - expect: A new report row appears with Sent to CFO showing a gray 'Not sent' badge and no 'Mark sent' button; on the Issue page the 'Generate receipts' button is disabled and the alert 'Only the party CFO (or an authorized designate) may issue receipts (s. 25.1(6)).' is shown
  5. In context A (sysadmin) open Admin, Roles, click 'Edit' on the custom role, tick 'Share entity reports', enter reason 'Add share', and save.
    - expect: The role row now lists three permissions including 'Share entity reports'
  6. In context B, without signing out, reload the Entity reports page.
    - expect: The report row now shows a 'Mark sent' button (Share is offered) and the user is still signed in; 'Generate receipts' on the Issue page is still disabled
  7. In context A open Admin, Change log, Subject type 'Role', find the update entry for the custom role.
    - expect: Before lists 'Read all records' and 'Generate entity reports'; After additionally lists 'Share entity reports'; actor and reason 'Add share' are shown
  8. In Admin, Roles click 'View' on the 'System administrator' row.
    - expect: The role is marked 'Locked' and shows 'Full system access'; its definition cannot be edited and there is no delete control

#### 1.8. Row 9: Roles are assignable to users, including custom roles, and shared by many users

**File:** `tests/eo/security/row-09-roles-assignable.spec.ts`

**Steps:**
  1. Mutates: creates role 'E2E Shared Role <suffix>' and users 'E2E Holder One <suffix>' and 'E2E Holder Two <suffix>'. Sign in as sysadmin; create the custom role with permission 'View entity reports', reason 'Shared role'.
    - expect: The role appears in Admin, Roles with 0 users
  2. Go to Admin, Users and click 'New user'. Open the Role select.
    - expect: The options include all ten built-in roles (Bookkeeper, Filer, Organizer, Party CFO, Process owner, Read only, Receipt administrator, Riding or campaign CFO, Rules authority, System administrator) and the custom role
  3. Create 'E2E Holder One <suffix>' with the custom role. Create 'E2E Holder Two <suffix>' with 'Read only'.
    - expect: Both rows appear; the first shows the custom role in the Role column
  4. Click 'Edit' on Holder Two, choose the custom role in the Role select, enter Reason 'Assign shared role', and click 'Save'.
    - expect: The Edit dialog's Role select lists the custom role; after saving, both rows show the custom role
  5. Open Admin, Roles.
    - expect: The custom role row shows 2 users
  6. Edit Holder Two back to 'Read only' with a reason.
    - expect: The role's user count returns to 1 and the Users table reflects the change

#### 1.9. Row 10: Sysadmin role is assignable, including to a newly created user

**File:** `tests/eo/security/row-10-sysadmin-role.spec.ts`

**Steps:**
  1. Mutates: creates user 'E2E Second Admin <suffix>' (e2e-admin2-<suffix>@gpo.test) with System administrator. Sign in as sysadmin and open Admin, Users.
    - expect: The row for sysadmin@gpo.test shows Role 'System administrator'
  2. Click 'New user', enter Name 'E2E Second Admin <suffix>', email, password 'second-admin-12345', choose Role 'System administrator', click 'Create user'.
    - expect: The new row shows Role 'System administrator' and status 'Active'
  3. Sign out and sign in as the new user. Open Admin, Users.
    - expect: Admin pages load, the 'New user' and 'Edit' controls are available, and Admin, Roles shows System administrator with 2 or more users

#### 1.10. Row 11: Deactivated accounts cannot sign in and open sessions are dropped

**File:** `tests/eo/security/row-11-deactivate-account.spec.ts`

**Steps:**
  1. Mutates: creates user 'E2E Deactivate <suffix>' (e2e-deactivate-<suffix>@gpo.test) and deactivates it. Context A: sign in as sysadmin and create the user (role Read only, password 'deactivate-pass-12345').
    - expect: The user is listed as Active
  2. In a second browser context B, sign in as the new user and leave a page such as Contributions open.
    - expect: The user is signed in
  3. In context A click 'Edit' on the user, untick 'Active (inactive users cannot sign in)', enter Reason 'Left the party', and click 'Save'.
    - expect: The row's Status shows inactive (not 'Active')
  4. In context B reload the page or click a navigation link.
    - expect: The session is dropped and the 'Sign in' form is shown
  5. In context B try to sign in again with the correct password.
    - expect: Sign-in is refused with an error and the user stays on the 'Sign in' form
  6. In context A re-tick Active with a reason and save; then in context B sign in again.
    - expect: Sign-in now succeeds, showing deactivation is reversible; the Change log (subject 'User') has entries for both status changes with the reasons

#### 1.11. Row 12: A user changes their own password and other sessions are signed out

**File:** `tests/eo/security/row-12-change-own-password.spec.ts`

**Steps:**
  1. Mutates: creates user 'E2E Pwd Self <suffix>' (e2e-pwdself-<suffix>@gpo.test, initial password 'pwd-initial-12345') and changes its password to 'pwd-changed-67890'. Create the user as sysadmin, then sign out.
    - expect: User exists
  2. Open two browser contexts A and B and sign in as the new user in both.
    - expect: Both are signed in
  3. In A open Account menu then 'Change password'. Enter Current password 'pwd-initial-12345', New password 'short', Confirm 'short'.
    - expect: The text 'At least 12 characters' is shown and 'Change password' is disabled
  4. Enter New password 'pwd-changed-67890' and Confirm 'different-67890'.
    - expect: 'Does not match the new password' is shown and the button stays disabled
  5. Enter a wrong Current password with matching new passwords and submit.
    - expect: An error alert is shown and the password is not changed
  6. Enter the correct Current password and matching new passwords 'pwd-changed-67890', and click 'Change password'.
    - expect: The alert 'Your password has been changed.' appears, mentioning that other signed-in sessions were signed out; click 'Done'
  7. In B reload the page.
    - expect: B is signed out and shows the 'Sign in' form
  8. In A reload the page.
    - expect: A is still signed in
  9. In a fresh context sign in with the old password 'pwd-initial-12345', then with 'pwd-changed-67890'.
    - expect: The old password is refused; the new password works
  10. As sysadmin open Admin, Change log, Subject type 'User'.
    - expect: An entry exists for that user with the user as actor recording the password change (no password or hash value is displayed in Before/After)

#### 1.12. Row 12: Admin resets a user's password and signs them out everywhere

**File:** `tests/eo/security/row-12-admin-reset-password.spec.ts`

**Steps:**
  1. Mutates: creates user 'E2E Pwd Reset <suffix>' (e2e-pwdreset-<suffix>@gpo.test) and resets its password. Context A: sysadmin creates the user (password 'reset-initial-12345').
    - expect: User listed as Active
  2. Contexts B and C: sign in as the new user in both.
    - expect: Both signed in
  3. In A click 'Reset password' on the user's row. Enter Temporary password 'short' and then 'reset-temp-67890-ab'; observe 'Reset password' (dialog button) while Reason is empty.
    - expect: The button is disabled until a 12+ character password and a reason are entered
  4. Enter Reason 'Forgot password' and click 'Reset password'.
    - expect: The dialog closes without error
  5. Reload B and C.
    - expect: Both show the 'Sign in' form (signed out everywhere)
  6. In B sign in with the old password, then with 'reset-temp-67890-ab'.
    - expect: The old password is refused; the temporary password works
  7. In A open Admin, Change log, Subject type 'User'.
    - expect: An entry for the user shows actor 'Sys Admin' and reason 'Forgot password', with no password or hash value displayed
