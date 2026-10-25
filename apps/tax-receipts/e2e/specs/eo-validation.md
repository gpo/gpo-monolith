# EO evaluation: Validation and Controls

## Application Overview

Rows 32-40 of the Elections Ontario evaluation checklist for the GPO Tax Receipts and Contributions tool: identifying and resolving ineligible contributors (B1, B3), duplicate contributors (B4), duplicate contributions (A6), over-limit contributions (B2), and recording the action taken. The demo surface is the Work queue (/work-queue, Validation tab, which is the default; it has no search or filter, so locate rows with getByRole('row').filter({ hasText: '<donor name>' })) and the Correct dialog on the contribution detail (Contribution card > Correct button; Action select; Preview cascade; Commit correction).

SHARED-DATA STRATEGY. Identify scenarios (rows 32, 34, 36, 38) read seeded fixtures only: Out Of Province Donor and Anonymous (2026 Annual party), Morgan Ellis and Morgan Elis (shared email morgan.ellis@fixture.test), Double Dana (two $50 PARTY contributions dated 5/1/2026 and 5/2/2026), and Blocked Blake ($3,500.00 CA riding 121, 2026 Annual; limit $3,425.00). They mutate nothing. Resolve scenarios (rows 33, 35, 37, 39, 40) NEVER touch a fixture: verified in the live app that every rule fires on data the scenario enters itself, so each resolve scenario creates its own contributor(s) with a unique suffix (use a timestamp, shown below as <suffix>) and resolves only those. No scenario in this file needs "must run after", and a rerun with E2E_SKIP_RESET=1 is safe because every created name is unique. Never assert total counts of work items or findings (other sections add A1 items in period 64 and open flags in spaces); always locate the row by the unique donor name.

LIVE ENTRY RECIPE (verified). Sign in as admin, go to /payments/new, click 'Not on file? Add a new contributor', fill the 'Add a contributor' dialog (First name, Last name, optionally Email; address ALL-OR-NOTHING: Street number, Street, City, Province, Postal code, with Country prefilled CA; Reason), click 'Add contributor' only when it is not marked [disabled], then fill the page's Amount ($) (first one), Received on, and Reason (required), check 'Save payment' is not [disabled], click it, then click 'Open the contribution'. Qomon is off, so contributors are tool-owned. Use period 64 ('2025 General Election', window 1/27/2025 to 5/28/2025) with Received on inside the window (2025-03-10 to 2025-03-16 used below) and leave Period on 'Derived from the date: 2025 General Election'. Exception, the only one: B2 (row 38/39) needs a 2026 accepted date, because contribution limits exist only for 2026 (Admin > Contribution limits: PARTY $5000.00, CA $3425.00, CAMPAIGN $3425.00 for 2026; a $6000 party payment dated 2025-03-15 produced no B2). For B2 the scenario records Received on 2026-06-01 and picks Period '2025 General Election' explicitly, which keeps the payment out of the 2026 Annual spaces other sections assert on; the cost is an extra A1 item ('Acceptance date is outside its period's window') on that contribution, which the scenario ignores. The payments page also shows an extra duplicate-donor guard: adding a contact whose email already exists shows 'this may be a contributor already on file: ...' and a checkbox 'This is a different person; add them anyway' that must be ticked before 'Add contributor' proceeds.

UI FACTS (verified). Work queue rows show Subject (link 'Contribution'), Donor, Rule (title and code in parentheses, e.g. 'Possible duplicate donor record (B4)'), Opened, Due, Status (OPEN, RESOLVED, EXCEPTION), Resolution (the note, or '—' while OPEN), and an unlabelled actions column (for OPEN rows the buttons 'Resolve' and 'Exception'; for EXCEPTION rows 'Edit'). Resolve opens the dialog 'Resolve work item' (multi-line textbox 'Resolution note', buttons 'Resolve' and 'Cancel'); Exception opens 'Record an exception' (multi-line textbox 'Exception reason', buttons 'Record exception' and 'Cancel'); the submit stays [disabled] until at least three characters are typed. Edit opens 'Edit exception', prefilled with the current reason, plus 'Reason for the edit (required)'; 'Save exception' stays [disabled] until the reason has changed and the edit reason has three characters. A correction closes the open items on the retired rows with the note 'closed by a correction: <contribution id> is now REFUNDED' (or SUPERSEDED). The Correct dialog 'Correct this contribution' has Action options 'Correct the amount', 'Move to another donor', 'Split between donors or entities', 'Reallocate to another entity (over-limit)' (only for users who can sign off filings: sign in as cfo, not admin), 'Refund', 'Merge this donor into another contact'; 'Commit correction' stays [disabled] until Preview cascade has run with a Reason (required) filled; on commit the dialog shows 'Correction committed'. The change-log explorer (Admin > Change log, /admin/change-log) has filters Subject type, Subject id, Actor user id, Correlation id, From, To and columns At, Subject, Actor, Reason, Before, After; it does NOT print the correlation id in a column, so tests read it from GET /api/change-log?subjectId=<id> (field correlationId, the signed-in page session cookie is enough, e.g. page.evaluate(fetch) or page.request.get) and then type it into the Correlation id filter. The UI has no Unmerge button; unmerge exists only as the API POST /api/contacts/:id/unmerge with body {"reason": "..."} (verified 200 with {"contactId", "mergedIntoId": null}); unmerge clears the merge flag but does not move contributions back.

Every scenario starts signed out and signs in with signIn(page, '<user>') from tests/helpers.ts. Logins used: admin (records payments, runs Refund and Merge, resolves items) and cfo (can use Reallocate). Test files go under tests/eo/validation/.

## Test Scenarios

### 1. Validation and controls (rows 32-40)

**Seed:** `apps/tax-receipts/e2e/tests/seed.spec.ts`

#### 1.1. Row 32: Work queue identifies the Out Of Province Donor as ineligible (B1)

**File:** `tests/eo/validation/row-32-out-of-province.spec.ts`

**Steps:**
  1. Sign in as admin. Mutates: nothing (reads the seeded fixture Out Of Province Donor, BC address 456 Robson St, Vancouver BC V6B 1A1).
    - expect: Signed in.
  2. Go to /work-queue. The Validation tab is the active tab by default.
    - expect: Heading 'Work queue' and buttons Validation, Diff queue, Owed to EO, Sync incidents, Delivery are visible.
    - expect: The table has columns Subject, Donor, Rule, Opened, Due, Status, Resolution.
  3. Find the row whose Donor is 'Out Of Province Donor' and whose Rule text contains '(B1)'.
    - expect: The Rule cell reads "Donor's address is out of province" with code (B1).
    - expect: Status is OPEN and the row has 'Resolve' and 'Exception' buttons (do not click them).
  4. Click the 'Contribution' link in that row.
    - expect: URL is /contributions/<id>.
    - expect: Address on file reads '456 Robson St, Vancouver BC V6B 1A1, CA'.
    - expect: The Work items table lists 'Donor's address is out of province (B1)' with status OPEN.

#### 1.2. Row 32: Work queue identifies the Anonymous donor as ineligible (B3)

**File:** `tests/eo/validation/row-32-anonymous.spec.ts`

**Steps:**
  1. Sign in as admin. Mutates: nothing (reads the seeded fixtures named Anonymous; there are two contacts with that name, one clean-address B3 and one 'kitchen sink' with a BC address).
    - expect: Signed in.
  2. Go to /work-queue and look at every row whose Donor is 'Anonymous'.
    - expect: At least one row has Rule "Donor is anonymous or unidentifiable" with code (B3) and Status OPEN.
    - expect: The kitchen-sink Anonymous contribution also shows B1, C2, C3, and C4 rows; do not assert how many rows exist in total.
  3. Open the Contribution link of an Anonymous B3 row.
    - expect: The Donor field reads 'Anonymous' and the Work items table includes 'Donor is anonymous or unidentifiable (B3)' with status OPEN.

#### 1.3. Row 33: Resolve an ineligible contributor by REFUND from the correction panel

**File:** `tests/eo/validation/row-33-refund-ineligible.spec.ts`

**Steps:**
  1. Sign in as admin. Mutates: creates contributor 'Ineligible Refund<suffix>' (BC address) and one $50.00 payment/contribution in period 64 dated 2025-03-15, then refunds it. No fixture is touched.
    - expect: Signed in.
  2. Go to /payments/new, click 'Not on file? Add a new contributor', and in the dialog fill First name 'Ineligible', Last name 'Refund<suffix>', Street number '456', Street 'Robson St', City 'Vancouver', Province 'BC' (select), Postal code 'V6B 1A1', Reason 'e2e b1'. Country stays CA. Confirm 'Add contributor' is not [disabled], then click it.
    - expect: The dialog closes and 'Donor who paid' shows the new contributor.
  3. Fill Amount ($) with 50, Received on with 2025-03-15, and Reason (required) with 'e2e b1'. Confirm 'Save payment' is not [disabled], click it, then click 'Open the contribution'.
    - expect: URL is /contributions/<id>; Period reads '2025 General Election'; Address on file reads '456 Robson St, Vancouver BC V6B 1A1, CA'.
    - expect: Work items lists 'Donor's address is out of province (B1)' and 'Postal code is malformed or outside Ontario (C3)', both OPEN.
  4. Record the contribution id from the URL. Click 'Correct' in the Contribution card. In the 'Correct this contribution' dialog choose Action 'Refund'.
    - expect: The text 'Marks this payment ($50.00) and its contributions refunded, and cancels any receipt for them...' is shown.
    - expect: 'Commit correction' is marked [disabled].
  5. Fill Reason (required) with 'e2e out of province refund' and click 'Preview cascade'.
    - expect: The preview table lists '<name>, $50.00, Party (province-wide)' with the outcome 'refunded'.
    - expect: 'Payment: $50.00 → $50.00, RECEIVED → REFUNDED' and 'None affected: nothing had been receipted.' appear.
    - expect: 'Commit correction' is now enabled.
  6. Click 'Commit correction'.
    - expect: The dialog shows 'Correction committed' and '0 contributions created, 0 receipts cancelled, no receipts issued.'
  7. Close the dialog (Escape) and read the contribution page.
    - expect: Banner 'This contribution is REFUNDED; it is history, not the working record.'
    - expect: Both work items (B1 and C3) now show RESOLVED.
  8. Go to /work-queue and find the rows for 'Ineligible Refund<suffix>'.
    - expect: Two rows (B1 and C3) with Status RESOLVED and Resolution 'closed by a correction: <contribution id> is now REFUNDED'.

#### 1.4. Row 33: Resolve an ineligible contributor as EXCEPTION with a reason

**File:** `tests/eo/validation/row-33-exception-ineligible.spec.ts`

**Steps:**
  1. Sign in as admin. Mutates: creates contributor 'Ineligible Except<suffix>' (BC address) and one $50.00 payment in period 64 dated 2025-03-15, then excepts its B1 item. No fixture is touched.
    - expect: Signed in.
  2. Create the contributor and payment exactly as in the refund scenario but with Last name 'Except<suffix>' and Reason 'e2e b1 exception' (BC address filled in full: 456 Robson St, Vancouver, BC, V6B 1A1).
    - expect: Payment recorded; the contribution page lists B1 as OPEN.
  3. Go to /work-queue and find the row with Donor 'Ineligible Except<suffix>' and Rule code (B1). Confirm its 'Exception' button is not [disabled], then click it.
    - expect: The dialog 'Record an exception' opens with a textbox 'Exception reason', 'Record exception' (marked [disabled]), and 'Cancel'.
  4. Type 'ab' into 'Exception reason'.
    - expect: 'Record exception' stays [disabled] (a note needs at least three characters).
  5. Replace the text with 'Ontario resident studying at UBC' and, once 'Record exception' is not [disabled], click it. (An exception means staff confirmed the donor IS an Ontario resident despite the address; a genuine non-resident is refunded, as in 1.3.)
    - expect: The dialog closes; the B1 row changes to Status EXCEPTION and its Resolution cell shows 'Ontario resident studying at UBC'.
    - expect: The C3 row for the same donor is still OPEN (the exception only covers B1).
  6. Click 'Edit' on the B1 row. In 'Edit exception', replace the reason with 'Ontario resident studying at UBC; home address in Ottawa confirmed with the donor by phone'.
    - expect: 'Exception reason' was prefilled with the old reason; 'Save exception' stays [disabled] until 'Reason for the edit (required)' is filled.
  7. Fill 'Reason for the edit (required)' with 'added how residency was confirmed' and click 'Save exception'.
    - expect: The dialog closes; the B1 row is still EXCEPTION and its Resolution cell shows the new reason.

#### 1.5. Row 34: Work queue identifies the Morgan Ellis and Morgan Elis duplicate contributors (B4)

**File:** `tests/eo/validation/row-34-duplicate-contributors-fixture.spec.ts`

**Steps:**
  1. Sign in as admin. Mutates: nothing (reads the seeded contacts Morgan Ellis and Morgan Elis, both morgan.ellis@fixture.test).
    - expect: Signed in.
  2. Go to /work-queue and find rows for 'Morgan Ellis' and 'Morgan Elis'.
    - expect: Exactly one B4 row for each contact, each reading 'Possible duplicate donor record' with code (B4) and Status OPEN.
  3. Open the Contribution link of the 'Morgan Ellis' row, then of the 'Morgan Elis' row.
    - expect: Ellis contribution is $40.00 (3/15/2026), Elis contribution is $60.00 (8/15/2026), both Party (province-wide), each Work items table includes 'Possible duplicate donor record (B4)' OPEN.
  4. Go to /contributors, type 'morgan.ellis@fixture.test' into the search box (placeholder 'Name or email (two letters or more)').
    - expect: Two contributors, 'Morgan Ellis' and 'Morgan Elis', are listed sharing that email.

#### 1.6. Row 34: Live: two contributors sharing an email raise B4 on the second one's contribution

**File:** `tests/eo/validation/row-34-live-duplicate-email.spec.ts`

**Steps:**
  1. Sign in as admin. Mutates: creates contributors 'Dupone Probe<suffix>' and 'Duptwo Probe<suffix>' sharing email 'dup.<suffix>@e2e.test', each with one payment in period 64. No fixture is touched.
    - expect: Signed in.
  2. At /payments/new add contributor First 'Dupone', Last 'Probe<suffix>', Email 'dup.<suffix>@e2e.test', Street number '10', Street 'Queen St', City 'Toronto', Postal code 'M5V 2T6', Reason 'e2e b4'. Add it, enter Amount 30, Received on 2025-03-15, Reason 'e2e b4', save, and open the contribution.
    - expect: Work items shows 'None.' (a lone contact has no duplicate).
  3. Return to /payments/new and click 'Not on file? Add a new contributor'. Fill First 'Duptwo', Last 'Probe<suffix>', the SAME Email, Street number '11', Street 'Queen St', City 'Toronto', Postal code 'M5V 2T6', Reason 'e2e b4'.
    - expect: A warning appears in the dialog: 'this may be a contributor already on file: Dupone Probe<suffix> (dup.<suffix>@e2e.test). Check the existing record, or confirm this is a different person' with a checkbox 'This is a different person; add them anyway'.
  4. Tick 'This is a different person; add them anyway' and click 'Add contributor' (confirm it is not [disabled]). Enter Amount 45 (different from the first, to avoid A6), Received on 2025-03-16, Reason 'e2e b4', save, and open the contribution.
    - expect: The Work items table lists 'Possible duplicate donor record (B4)' with status OPEN.
    - expect: (Verified: the B4 finding appears on the second contact's contribution; do not assert one on the first, which was validated before the duplicate existed.)
  5. Go to /work-queue and find the row for 'Duptwo Probe<suffix>'.
    - expect: One row, Rule 'Possible duplicate donor record (B4)', Status OPEN.

#### 1.7. Row 35: Resolve duplicate contributors with MERGE_CONTACTS and show the merge is reversible

**File:** `tests/eo/validation/row-35-merge-contacts.spec.ts`

**Steps:**
  1. Sign in as admin. Mutates: creates contributors 'Dupone Merge<suffix>' and 'Duptwo Merge<suffix>' (shared email 'merge.<suffix>@e2e.test') and one payment each in period 64, merges Duptwo into Dupone, then unmerges via the API. No fixture is touched; the seeded Morgan pair is left alone.
    - expect: Signed in.
  2. Create both contributors and payments as in the row 34 live scenario (Dupone: $30 on 2025-03-15; Duptwo: $45 on 2025-03-16, ticking 'This is a different person; add them anyway'). Open Duptwo's contribution and record its id and the Duptwo contact id (the 'Donor' link href /contributors/<contact id>).
    - expect: Duptwo's contribution has a B4 work item OPEN.
  3. Click 'Correct' in the Contribution card and choose Action 'Merge this donor into another contact'.
    - expect: A field labelled 'Merge Duptwo Merge<suffix> into' (placeholder 'Search by name or email') and 'Evidence they are the same person (required if anything was RTD-reported)' appear.
    - expect: 'Commit correction' is [disabled].
  4. Type 'Dupone Merge<suffix>' into the 'Merge ... into' field and click the option 'Dupone Merge<suffix> (merge.<suffix>@e2e.test)'. Fill Reason (required) with 'e2e same person, duplicate record' and click 'Preview cascade'.
    - expect: The preview shows 'Duptwo Merge<suffix>, $45.00, Party (province-wide)' becomes 'Dupone Merge<suffix>, $45.00, Party (province-wide)' and 'None affected: nothing had been receipted.'
    - expect: 'Commit correction' is now enabled.
  5. Click 'Commit correction'.
    - expect: Dialog shows 'Correction committed' and '1 contribution created, 0 receipts cancelled, no receipts issued.' with a Replacement link 'open it'.
  6. Close the dialog; read the original contribution page.
    - expect: Banner 'This contribution is SUPERSEDED; it is history, not the working record.'
  7. Go to /work-queue and find the row for 'Duptwo Merge<suffix>'.
    - expect: The B4 row has Status RESOLVED and Resolution 'closed by a correction: <original contribution id> is now SUPERSEDED'.
  8. Go to /contributors and search 'Dupone Merge<suffix>', open the contributor.
    - expect: Its Contributions table lists both contributions: $45.00 (3/16/2025) and $30.00 (3/15/2025), both ACTIVE.
    - expect: Searching /contributors for 'Duptwo Merge<suffix>' returns no row (the merged-away contact is hidden).
  9. Show reversibility: with the signed-in session call POST /api/contacts/<Duptwo contact id>/unmerge with JSON body {"reason":"e2e they are two people"} (page.request.post, or fetch in page.evaluate). The UI has no Unmerge button.
    - expect: Response status 200 with body containing "mergedIntoId":null.
  10. Open /contributors/<Duptwo contact id>.
    - expect: The contributor page loads again with name 'Duptwo Merge<suffix>', and its Contributions table shows the $45.00 contribution with Status SUPERSEDED (unmerge restores the contact, it does not move the contribution back).

#### 1.8. Row 36: Work queue identifies Double Dana's two $50 PARTY contributions as possible duplicates (A6)

**File:** `tests/eo/validation/row-36-duplicate-contributions-fixture.spec.ts`

**Steps:**
  1. Sign in as admin. Mutates: nothing (reads the seeded donor Double Dana).
    - expect: Signed in.
  2. Go to /work-queue and find the rows with Donor 'Double Dana'.
    - expect: Exactly two rows, each Rule 'Possible duplicate contribution' with code (A6), Status OPEN.
  3. Open the first row's Contribution link, note the Payment card and Contribution card, then go back and open the second row's link.
    - expect: Each is a $50.00 PARTY (Party (province-wide)) contribution; Accepted on 5/1/2026 for one and 5/2/2026 for the other.
    - expect: They belong to two different payments (each Payment card shows its own 'Received on' date and the two contribution ids in the URLs differ).

#### 1.9. Row 36: Live: a repeat same-amount gift a day later raises A6

**File:** `tests/eo/validation/row-36-live-duplicate-contribution.spec.ts`

**Steps:**
  1. Sign in as admin. Mutates: creates contributor 'Dblprobe Gift<suffix>' and two $50.00 payments in period 64 (2025-03-10 and 2025-03-11).
    - expect: Signed in.
  2. At /payments/new add the contributor (First 'Dblprobe', Last 'Gift<suffix>', Street number '12', Street 'Queen St', City 'Toronto', Postal code 'M5V 2T6', Reason 'e2e a6'). Enter Amount 50, Received on 2025-03-10, Reason 'e2e a6', save, and open the contribution.
    - expect: Work items shows 'None.'
  3. Go to /payments/new again, type 'Dblprobe' into 'Donor who paid', click the option 'Dblprobe Gift<suffix>...'. Enter Amount 50, Received on 2025-03-11, Reason 'e2e a6', save, and open the contribution.
    - expect: Period reads '2025 General Election'; Work items lists 'Possible duplicate contribution (A6)' OPEN.
    - expect: (Verified: only the later contribution is flagged; the first one stays 'None.')
  4. Go to /work-queue and find the row for 'Dblprobe Gift<suffix>'.
    - expect: One row with Rule code (A6) and Status OPEN.

#### 1.10. Row 37: Resolve a duplicate contribution by REFUNDing the duplicate

**File:** `tests/eo/validation/row-37-refund-duplicate.spec.ts`

**Steps:**
  1. Sign in as admin. Mutates: creates contributor 'Dblprobe Refund<suffix>' with two $50.00 period-64 payments (2025-03-10 and 2025-03-11) and refunds the second. No fixture (not Double Dana) is touched.
    - expect: Signed in.
  2. Create the contributor and both payments exactly as in the row 36 live scenario (Last name 'Refund<suffix>'). End on the second contribution, which has an OPEN A6 item.
    - expect: Work items lists 'Possible duplicate contribution (A6)' OPEN.
  3. Click 'Correct', choose Action 'Refund', fill Reason (required) with 'e2e duplicate gift refunded', click 'Preview cascade'.
    - expect: Preview shows '$50.00, Party (province-wide)' refunded and 'Payment: $50.00 → $50.00, RECEIVED → REFUNDED'.
    - expect: 'Commit correction' is enabled.
  4. Click 'Commit correction'.
    - expect: 'Correction committed' appears.
  5. Close the dialog and go to /work-queue; find the row for 'Dblprobe Refund<suffix>'.
    - expect: The A6 row is Status RESOLVED with Resolution 'closed by a correction: <contribution id> is now REFUNDED'.
  6. Open the first (original) contribution from /contributions by searching the donor name.
    - expect: It is still ACTIVE ($50.00, 3/10/2025); only the duplicate was refunded.

#### 1.11. Row 37: Resolve a duplicate contribution as EXCEPTION (distinct gifts)

**File:** `tests/eo/validation/row-37-exception-duplicate.spec.ts`

**Steps:**
  1. Sign in as admin. Mutates: creates contributor 'Dblprobe Distinct<suffix>' with two $50.00 period-64 payments and excepts the A6 item. No fixture is touched.
    - expect: Signed in.
  2. Create the contributor and both payments as in the row 36 live scenario (Last name 'Distinct<suffix>').
    - expect: The second contribution has A6 OPEN.
  3. Go to /work-queue, find the row for 'Dblprobe Distinct<suffix>', confirm 'Exception' is not [disabled], and click it.
    - expect: Dialog 'Record an exception' with textbox 'Exception reason', 'Record exception' [disabled], and 'Cancel'.
  4. Type 'distinct gifts' and, once 'Record exception' is not [disabled], click it.
    - expect: The row shows Status EXCEPTION and Resolution 'distinct gifts' (verified).
  5. Reload /work-queue.
    - expect: The row still shows EXCEPTION and 'distinct gifts'; both contributions remain ACTIVE (nothing refunded).

#### 1.12. Row 38: Blocked Blake is over the CA limit (B2) and the whole of Space B is blocked from issuance

**File:** `tests/eo/validation/row-38-over-limit-fixture.spec.ts`

**Steps:**
  1. Sign in as cfo. Mutates: nothing (reads the seeded Blocked Blake $3,500.00 CA riding 121 contribution in 2026 Annual and the issuance review page; does not click Generate). cfo is used because the over-limit proposal is only offered to filers.
    - expect: Signed in.
  2. Go to /work-queue and find the row for 'Blocked Blake' with Rule code (B2).
    - expect: Rule reads 'Donor is over a contribution limit' (B2) with Status OPEN. (Blocked Blake also has an A4 row; ignore it.)
  3. Open that row's Contribution link.
    - expect: Amount $3500.00; Recipient 'Constituency association, riding 121'; Period '2026 Annual'; Work items includes 'Donor is over a contribution limit (B2)' OPEN.
  4. Click 'Correct', choose Action 'Reallocate to another entity (over-limit)' and click 'Show over-limit proposal'. Do not commit; close the dialog with Escape afterwards.
    - expect: The panel reads 'Over the CA limit by $75.00 ($3500.00 against $3425.00).' and offers 'Move $75.00 to PARTY ...; room for $5000.00.' with a 'Use this' button.
  5. Go to /spaces/67/CA/issue?ridingNumber=121 (the dashboard row '2026 Annual, York—Simcoe, Constituency association' > Issue).
    - expect: Heading 'Issue receipts' and 'Period 67 · Riding 121 · Constituency association' with steps Review, Generate, Deliver.
    - expect: A heading matching /open work item\(s\) block issuance for this space/ and a table (Donor, Rule) that lists 'Blocked Blake' with 'Donor is over a contribution limit (B2)' and also lists 'Clean Casey' (a different donor, showing the whole space is blocked).
    - expect: 'Next: generate' is marked [disabled]; do not click it. (Do not assert the item count.)

#### 1.13. Row 39: Reallocate an over-limit contribution from the over-limit proposal (cfo)

**File:** `tests/eo/validation/row-39-reallocate.spec.ts`

**Steps:**
  1. Sign in as admin to create the data. Mutates: creates contributor 'Limit Realloc<suffix>' and one $6000.00 PARTY payment in period 64 with Received on 2026-06-01 (the only way to hit the 2026 limits; an A1 item opens too), then, signed in as cfo, reallocates $1,000 to CA riding 121. No fixture is touched.
    - expect: Signed in as admin.
  2. At /payments/new add the contributor (First 'Limit', Last 'Realloc<suffix>', Street number '13', Street 'Queen St', City 'Toronto', Postal code 'M5V 2T6', Reason 'e2e b2'). Fill Amount ($) 6000, Received on 2026-06-01, set Period to '2025 General Election' (select), Reason 'e2e b2', save, and open the contribution.
    - expect: Work items lists 'Donor is over a contribution limit (B2)' OPEN (and 'Acceptance date is outside its period's window (A1)' OPEN, ignored).
  3. Verify the admin role has no Reallocate: click 'Correct' and read the Action options, then close the dialog.
    - expect: Options are Correct the amount, Move to another donor, Split between donors or entities, Refund, Merge this donor into another contact (no 'Reallocate ...').
  4. Sign out (clear cookies / new context) and signIn(page, 'cfo'). Open the same contribution URL, click 'Correct', and choose Action 'Reallocate to another entity (over-limit)'.
    - expect: Action options now include 'Reallocate to another entity (over-limit)'.
    - expect: A parts editor shows 'Part 1 amount ($)' 6000, Entity and Riding fields, and 'Parts total $6000.00 of $6000.00'.
  5. Click 'Show over-limit proposal'.
    - expect: Text 'Over the PARTY limit by $1000.00 ($6000.00 against $5000.00).' and options 'Move $1000.00 to CA ? (choose the riding); room for $3425.00.' and the same for CAMPAIGN, each with a 'Use this' button.
  6. Click 'Use this' on the CA option. Then in the new 'Part 2' set Riding by typing '121' into its Riding field and clicking the option containing 121. Fill Reason (required) with 'e2e reallocate overage'.
    - expect: Part 1 amount 5000 Party (province-wide); Part 2 amount 1000 Constituency association, riding 121; 'Parts total $6000.00 of $6000.00'.
  7. Click 'Preview cascade'.
    - expect: Preview: '<name>, $6000.00, Party (province-wide)' becomes '<name>, $5000.00, Party (province-wide)' and '<name>, $1000.00, CA 121'; 'None affected: nothing had been receipted.'; 'Commit correction' enabled.
  8. Click 'Commit correction'.
    - expect: 'Correction committed' with '2 contributions created' and Replacement links 'part 1' and 'part 2'.
  9. Close the dialog and go to /work-queue; find the rows for 'Limit Realloc<suffix>'.
    - expect: The B2 row (and the A1 row) on the original contribution show Status RESOLVED with Resolution 'closed by a correction: <contribution id> is now SUPERSEDED'. Do not assert on A1 rows of the replacements.

#### 1.14. Row 39: Resolve an over-limit contribution by refunding it

**File:** `tests/eo/validation/row-39-refund-over-limit.spec.ts`

**Steps:**
  1. Sign in as admin. Mutates: creates contributor 'Limit Refund<suffix>' and one $6000.00 PARTY payment in period 64 dated 2026-06-01, then refunds it. No fixture is touched.
    - expect: Signed in.
  2. Create the contributor and payment as in the reallocate scenario (Last name 'Refund<suffix>'; Period explicitly '2025 General Election'; Received on 2026-06-01). Open the contribution.
    - expect: B2 is OPEN.
  3. Click 'Correct', choose 'Refund', Reason 'e2e over-limit refund', 'Preview cascade', then 'Commit correction' once it is not [disabled].
    - expect: 'Correction committed'; the page banner reads 'This contribution is REFUNDED; it is history, not the working record.'
  4. Go to /work-queue and find the rows for 'Limit Refund<suffix>'.
    - expect: B2 row Status RESOLVED, Resolution 'closed by a correction: <contribution id> is now REFUNDED'.

#### 1.15. Row 40: A resolved work item shows its resolution note and the correction's change-log entries share a correlation id

**File:** `tests/eo/validation/row-40-record-action-taken.spec.ts`

**Steps:**
  1. Sign in as admin. Mutates: creates contributor 'Audit Trail<suffix>' (BC address) and one $50.00 payment in period 64 dated 2025-03-15, refunds it, and excepts a second item. Asserts only on items this scenario resolved.
    - expect: Signed in.
  2. Create the contributor with the full BC address (456 Robson St, Vancouver, BC, V6B 1A1) and the payment as in row 33; open the contribution and record its id (the URL segment).
    - expect: B1 and C3 are OPEN.
  3. Resolve one item by exception first: go to /work-queue, find the row for 'Audit Trail<suffix>' with code (C3), click 'Exception', type 'e2e postal code reviewed' in the 'Record an exception' dialog and click 'Record exception' once it is not [disabled].
    - expect: That row shows Status EXCEPTION and Resolution 'e2e postal code reviewed'.
  4. Back on the contribution, run Correct > Refund with Reason 'e2e audit trail refund' (Preview cascade, then Commit correction).
    - expect: 'Correction committed'.
  5. Go to /work-queue and read the 'Audit Trail<suffix>' B1 row.
    - expect: Status RESOLVED and Resolution 'closed by a correction: <contribution id> is now REFUNDED' (the recorded action taken).
  6. Read the correlation id: GET /api/change-log?subjectId=<contribution id> in the signed-in session and take the correlationId of the entry whose reason is 'e2e audit trail refund' (its after is {"status":"REFUNDED"}).
    - expect: The response lists the creation entry (reason of the payment) and the refund entry with different correlation ids.
  7. Open /admin/change-log, type that correlation id into the 'Correlation id' textbox, and wait for the table to update.
    - expect: The table lists several entries, all with reason 'e2e audit trail refund' and the same actor: a 'Contribution (<id>)' row (ACTIVE to REFUNDED), a 'Payment (<id>)' row (RECEIVED to REFUNDED), and a 'WorkItem (<id>)' row for the B1 item (OPEN to RESOLVED). Do not assert an exact count beyond at least these three types. The correlation id itself is not a visible column.
  8. Clear the Correlation id box and type the subject id of the contribution into 'Subject id' instead.
    - expect: Only the Contribution rows for that id appear: the creation entry (reason 'e2e b1'-style text from the payment) and the refund entry, which carry different correlation ids, showing one correction shares one id.
