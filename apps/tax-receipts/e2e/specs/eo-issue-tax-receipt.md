# EO evaluation: Issue Tax Receipt

## Application Overview

Scenarios for the Elections Ontario evaluation section "Issue Tax Receipt" (rows 41 to 65): generating receipts from contribution records, what the receipt PDF prints, the stored receipt record and audit trail, corrections (lost copy, cancel, cancellation notice, reissue), and delivery.

## Shared-data strategy (read first)

Issuing, cancelling, reissuing, and reprinting change data for good, and a rerun cannot issue the same contribution twice. So every issuing scenario builds its OWN period, contributor, and payments (unique names with a random suffix) and issues from that period's space. Own-period issuance was verified live: a period created under Admin > Periods appears on the cfo dashboard with an Issue link, and its space is not blocked when its contributions are clean. Period 64 is NOT used for issuance (other sections leave open validation findings there).

Seeded fixtures are READ ONLY in this section. No scenario mutates any seeded fixture, and nothing touches periods 9502, 9503, or 9504 (9503 and 9504 receipts are only viewed or downloaded). The only shared state a scenario changes is: the global receipt-number sequence (consumed by every issue), and, in Row 56 only, the global receipt layout setting (switched to "With contributor type" and always switched back to "Original" in a finally block). A rerun with E2E_SKIP_RESET=1 works, because all created data carries a fresh suffix.

Logins (all @gpo.test, password change-me-please-12345): sysadmin (creates periods, Admin pages), admin (adds contributors, payments, edits contributors), cfo (issues receipts, corrects, delivers). Every scenario starts signed out and uses `signIn(page, '<user>')` from `tests/helpers.ts`. Switching user mid-scenario: open Account menu > Sign out and wait for /login (an extra wait avoids racing the sign-in form), then signIn again.

## Reading PDFs

`pdfText(download)` takes a Playwright `Download`. The "View PDF", "Cancellation notice" links open `/api/receipts/<receiptId>/pdf` and `/api/receipts/<receiptId>/cancellation-notice` with target=_blank, and may open a viewer tab instead of downloading. The reliable way is to read the link's href, then `const res = await page.request.get(href)` (it carries the session cookie) and parse `await res.body()`. The generator should add a small helper in `tests/helpers.ts`, `pdfTextFromBuffer(buf)`, that does what `pdfText` does for a Buffer. Where a download event does fire, `pdfText(download)` is fine. Either way assertions are on the extracted text.

PDF text facts (from api/src/receipts/pdf.ts): the receipt prints, per copy, "Issue Date: YYYY-MM-DD" (UTC date), "Received on: YYYY-MM-DD" (or "YYYY-MM-DD to YYYY-MM-DD" for a combined receipt), "Eligible Amount: $80.00", "Contribution Type: Monetary" or "Goods and Services", "Received By: <label>", "Receipt No: GPO-00######", "Received from:" then the donor name and address UPPER-CASED (postal code printed without its space, for example "K1A0B1"), plus template text "This is your Official Receipt for income tax purposes.", "Authorized Signature", and "Green Party of Ontario". A reissued receipt adds "This cancels and replaces receipt #GPO-...", a lost-receipt reprint adds "COPY", and the cancelled copy is watermarked "CANCELLED". Under the contributor-type layout "Contributor Type: Individual" is added. Dates in assertions are computed in UTC, for example `new Date().toISOString().slice(0, 10)`.

## Shared setup recipe "R" (used by most scenarios)

Each scenario that says "Recipe R" runs this with its own suffix `S` (for example `Date.now()` plus a random number) and may change the listed variants. Recipe R is repeated in full inside each scenario's own steps where it matters, but is summarised here to avoid noise:

R1. As sysadmin, open /admin/periods. Fill Id (EO period id) with `96000 + random(0..999)` (retry with a new number if the id already appears in the table), Name `E2E <S>`, Kind ANNUAL (variant: GENERAL_ELECTION for campaign scenarios), Starts at (UTC) `2024-01-01T00:00`, Ends at (UTC) `2024-02-01T00:00` (the field is a datetime-local input, so a plain date is rejected as "Malformed value"), Reason `E2E period`. Save period is disabled until every field and the reason are filled; then click it and expect "Saved. Validation re-run against every mirrored contribution." and a new table row with the id.
R2. As admin, open /contributors, choose "Add a contributor". Fill First name `Iris`, Last name `Issuer<S>`, Email `iris.<S>@e2e.test`, leave Contributor type Individual, and fill the address ALL-OR-NOTHING: Street number `77`, Street `Maple Ave`, City `Ottawa`, Province ON (select), Postal code `K1A 0B1`, Country `CA`, Reason `E2E contributor`. "Add contributor" stays disabled until the required fields and reason are filled. Submitting lands on /contributors/<id> showing "Address: 77 Maple Ave, Ottawa ON K1A 0B1, CA" and "Kept in: This tool" (Qomon is off, so every contributor is tool-owned and editable).
R3. As admin, open /payments/new ("Add a payment"). Type the surname in "Donor who paid" and choose the "Iris Issuer<S> (email)" option, fill Amount ($) (for example 50), "Received on" `2024-01-10`, leave Method Cheque, choose the contribution's Period `E2E <S>` explicitly in the Period select (the "Derived from the date" default can pick a different period if another scenario's window overlaps), Reason `E2E payment`. "Save payment" is disabled until the reason is filled. Expect "Payment recorded". Use "Enter another payment" for more payments. The contribution section can set Recipient (Party, Constituency association, Campaign, Leadership contestant), Riding (a type-ahead, choose "121 . York-Simcoe"), "Accepted on", and the checkbox "Donor received goods or services" with "Non-deductible ($)".
R4. As cfo, open `/spaces/<periodId>/PARTY/issue` (for a campaign: `/spaces/<periodId>/CAMPAIGN/issue?ridingNumber=121`). Review shows "Receipts", "Total amount", a donor table (Donor, Contributions, Amount, Delivery), and the switch "One receipt per donor". Choose "Next: generate". Received-by label is prefilled "Green Party of Ontario" for a party space (blank for a campaign; type it). Delivery override select has "Use each donor's preference", "Force mail for all", "Force email for all". Fill "Reason for this issuance run (required)" `E2E issue`; "Generate receipts" is disabled until then. Expect "1 issued, 0 failed." (count varies), the row's receipt number `GPO-00######`, the amount, and a "View PDF" link.

Mutates for R as a whole: creates one period, one contributor, one to three payments and their receipts, all uniquely named. No seeded fixture is touched.

## Test Scenarios

### 1. Issuance and receipt contents

**Seed:** `tests/seed.spec.ts`

#### 1.1. Row 41: Generate receipts from contribution records in the space wizard and download the PDF

**File:** `tests/eo/issue-tax-receipt/row-41-generate-receipts.spec.ts`

**Steps:**
  1. Read-only look at Space A. Sign in as cfo, open /spaces/9502/PARTY/issue. Do NOT choose Generate.
    - expect: Heading 'Issue receipts' and 'Period 9502 . Party (province-wide)'.
    - expect: The Review preview lists donors Ready Rita ($50.00) and Partial Credit Priya (eligible amount below her $100 gift), and does not list Already Issued Ivy (already fully receipted).
    - expect: Nothing is issued by looking.
  2. Create own data with Recipe R1 to R3: a period, one contributor, and TWO payments for that contributor ($50 on 2024-01-10 and $30 on 2024-01-20) so the run issues more than one row. Sign in as cfo and open /spaces/<periodId>/PARTY/issue (R4 up to the Review step).
    - expect: The own space is not blocked: no 'open work item(s) block issuance' message.
    - expect: Receipts count is 2, Total amount is $80.00, and the table has two rows for Iris Issuer<S>.
  3. Choose 'Next: generate', keep the label 'Green Party of Ontario', fill the run reason, click 'Generate receipts' (enabled once the reason is filled).
    - expect: '2 issued, 0 failed.'
    - expect: Each result row shows a receipt number matching /GPO-00\d{6}/, its amount, and a 'View PDF' link.
  4. Take the href of the first 'View PDF' link (/api/receipts/<id>/pdf), fetch it with page.request.get, and extract the text with the PDF helper.
    - expect: Response status 200 with content-type application/pdf.
    - expect: Text contains the receipt number from the result row, 'Eligible Amount: $50.00' or '$30.00' as appropriate, and the donor name IRIS ISSUER<S> upper-cased.
  5. Open the contribution (link in the result row) at /contributions/<id>.
    - expect: 'Allocations & receipts' lists the same receipt number with status ISSUED and a 'View PDF' link.
    - expect: The contribution's own 'Edit' button is now disabled (receipted data is frozen).

#### 1.2. Row 46: Combine a donor's contributions onto one receipt with One receipt per donor, goods and services stay separate

**File:** `tests/eo/issue-tax-receipt/row-46-one-receipt-per-donor.spec.ts`

**Steps:**
  1. Recipe R1 and R2. Then R3 three times for the same contributor: $50 monetary on 2024-01-10, $30 monetary on 2024-01-20, and a goods-and-services payment of $100 on 2024-01-25 with 'Donor received goods or services' ticked and Non-deductible ($) 20 (the field is disabled until the checkbox is ticked).
    - expect: Three payments recorded.
  2. Sign in as cfo, open /spaces/<periodId>/PARTY/issue. With the 'One receipt per donor' switch OFF (default), read the preview.
    - expect: Receipts is 3 and each row for Iris Issuer<S> has Contributions 1.
  3. Turn the 'One receipt per donor' switch ON (click its label) and wait for the preview to refresh.
    - expect: Receipts is 2 (monetary pair combined; goods and services separate).
    - expect: One row shows Contributions 2 with Amount $80.00 and another row shows Contributions 1 with Amount $80.00 (the $100 gift less $20 non-deductible).
    - expect: Total amount is $160.00.
  4. Choose 'Next: generate', fill the reason, click 'Generate receipts'.
    - expect: '2 issued, 0 failed.'
    - expect: One result reads '<contribution id> and 1 more (one combined receipt)' with $80.00 and a receipt number; the other is a single receipt.
  5. Fetch the combined receipt's 'View PDF' and extract text.
    - expect: 'Eligible Amount: $80.00', 'Received on: 2024-01-10 to 2024-01-20', 'Contribution Type: Monetary'.
  6. Fetch the other receipt's PDF.
    - expect: 'Contribution Type: Goods and Services' and 'Eligible Amount: $80.00'.

#### 1.3. Row 47: Receipt numbers are sequential (two receipts issued in a row differ by one)

**File:** `tests/eo/issue-tax-receipt/row-47-sequential-numbers.spec.ts`

**Steps:**
  1. Recipe R1 to R3 with TWO payments for one contributor ($50 on 2024-01-10, $30 on 2024-01-20). In the wizard leave 'One receipt per donor' OFF and generate, so two receipts are issued in one run.
    - expect: '2 issued, 0 failed.' with two receipt numbers.
  2. Read both numbers from the result rows, matching /^GPO-00\d{6}$/ each, and parse the digits as integers.
    - expect: Both match the GPO-00###### format.
    - expect: The two numbers differ by exactly 1 (never assert a literal number; the sequence is shared and other scenarios consume it).
  3. Fetch each 'View PDF' and read 'Receipt No: GPO-...'.
    - expect: Each PDF prints the same number as its result row.

#### 1.4. Row 43: Aggregated receipt records each contribution (Consolidating Chris read-only, plus a live combine)

**File:** `tests/eo/issue-tax-receipt/row-43-aggregated-receipt.spec.ts`

**Steps:**
  1. Read-only fixture. Sign in as cfo, open /contributors, search 'Consolidating', open Consolidating Chris. Mutates nothing in period 9504.
    - expect: Contributions table shows two ACTIVE contributions in period 9504, $40.00 and $25.00, each with Left to receipt $0.00.
  2. Open each contribution (links in the Accepted column) and read 'Allocations & receipts'.
    - expect: Both show the SAME receipt number with status ISSUED, one row allocating $40.00 and the other $25.00.
  3. Fetch the receipt's 'View PDF' and extract text.
    - expect: Contains '$65.00' and 'Received on: 2030-03-05 to 2030-03-10'.
  4. Live part. Recipe R1 and R2, then R3 twice for the own contributor ($40 on 2024-01-10, $25 on 2024-01-15). Sign in as cfo and open the contributor's record /contributors/<id>.
    - expect: 'Tick two or more contributions to issue one receipt for all of them.' appears above the Contributions table, with a checkbox per row labelled 'Select the contribution of <date>'.
  5. Tick both checkboxes (match by role checkbox and name /Select the contribution of/, since the date text is locale-formatted).
    - expect: Text 'One receipt for 2 contributions, totalling $65.00.'
    - expect: A Received-by label field prefilled 'Green Party of Ontario' and a 'Reason (required)' field appear; the 'Issue one receipt' button is disabled until the reason has 3 or more characters.
  6. Fill the reason 'E2E combine' and click 'Issue one receipt'.
    - expect: A green alert 'Issued GPO-00###### for $65.00.' with a 'View PDF' link.
  7. Fetch that PDF.
    - expect: Contains '$65.00' and 'Received on: 2024-01-10 to 2024-01-15'.
    - expect: Both contributions in the table now show Left to receipt $0.00 and each contribution page lists the same receipt number.

#### 1.5. Row 48: Receipt reads 'Official receipt for income tax purposes'

**File:** `tests/eo/issue-tax-receipt/row-48-official-receipt-wording.spec.ts`

**Steps:**
  1. Recipe R1 to R4 with one $50 payment; fetch the issued receipt PDF and extract text.
    - expect: Text contains 'This is your Official Receipt for income tax purposes.'

#### 1.6. Row 49: Political entity name on the receipt, party and campaign

**File:** `tests/eo/issue-tax-receipt/row-49-political-entity-name.spec.ts`

**Steps:**
  1. Party case. Recipe R1 to R4 (ANNUAL period, label 'Green Party of Ontario'); fetch the PDF.
    - expect: Text contains 'Received By: Green Party of Ontario'.
  2. Campaign case with its own period. As sysadmin create a second period of Kind GENERAL_ELECTION (an ANNUAL period never has an active campaign, so a campaign contribution in it opens an A2 work item that blocks the space; a seeded BY_ELECTION period cannot be created in the UI because the form has no riding field). Window 2024-01-01T00:00 to 2024-02-01T00:00. As admin add a contributor (R2) and a payment (R3) with Recipient 'Campaign', Riding '121 . York-Simcoe', $25, received 2024-01-12, Period set to the GE period.
    - expect: Payment recorded.
  3. As cfo open /spaces/<gePeriodId>/CAMPAIGN/issue?ridingNumber=121.
    - expect: Header 'Period <id> . Riding 121 . Campaign', no blocking work items, one receipt of $25.00.
  4. Choose 'Next: generate'. The Received-by label is BLANK for a campaign, so 'Generate receipts' stays disabled until a label and reason are entered. Fill label 'York-Simcoe Green Campaign E2E' and the reason, then click 'Generate receipts'.
    - expect: '1 issued, 0 failed.'
  5. Fetch the PDF.
    - expect: Text contains 'Received By: York-Simcoe Green Campaign E2E' (the campaign label, not 'Green Party of Ontario').

#### 1.7. Row 50: Contribution acceptance date on the receipt ('Received on')

**File:** `tests/eo/issue-tax-receipt/row-50-acceptance-date.spec.ts`

**Steps:**
  1. Recipe R1 and R2; in R3 enter a payment with Received on 2024-01-10 and, in the contribution section, 'Accepted on' 2024-01-17 (different dates so the right one is proven). Issue with R4 and fetch the PDF.
    - expect: Text contains 'Received on: 2024-01-17' (the acceptance date) and does not contain 'Received on: 2024-01-10'.
    - expect: The contribution page shows Accepted on 1/17/2024 (locale formatted).

#### 1.8. Row 51: Receipt issue date

**File:** `tests/eo/issue-tax-receipt/row-51-issue-date.spec.ts`

**Steps:**
  1. Recipe R1 to R4 with one payment; record `before = new Date().toISOString().slice(0,10)` before generating and `after` the same way once generated. Fetch the PDF.
    - expect: Text contains 'Issue Date: ' followed by a date equal to before or after (UTC; allows for crossing midnight).
    - expect: The issue date is today, not the 2024 acceptance date, and the contribution page's receipt row shows today's date.

#### 1.9. Row 52: Eligible amount, including a goods-and-services gift with a non-deductible portion

**File:** `tests/eo/issue-tax-receipt/row-52-eligible-amount.spec.ts`

**Steps:**
  1. Recipe R1 and R2. R3 payment A: $100 monetary on 2024-01-10. R3 payment B: $100 with 'Donor received goods or services' ticked and Non-deductible ($) 20 on 2024-01-11. Issue both with 'One receipt per donor' OFF (R4).
    - expect: '2 issued, 0 failed.'; the preview earlier showed one $100.00 and one $80.00 row.
  2. Fetch each PDF.
    - expect: Monetary receipt contains 'Eligible Amount: $100.00'.
    - expect: Goods-and-services receipt contains 'Eligible Amount: $80.00' (not $100.00).
  3. Read-only cross-check with the seeded fixture Goods Gita in period 9503: open her contribution from /contributors, fetch her receipt's 'View PDF'.
    - expect: Text contains 'Eligible Amount: $80.00' and 'Contribution Type: Goods and Services'.

#### 1.10. Row 53: Contributor name and address on the receipt

**File:** `tests/eo/issue-tax-receipt/row-53-name-and-address.spec.ts`

**Steps:**
  1. Recipe R1 to R4 with the contributor 'Iris Issuer<S>' at 77 Maple Ave, Ottawa ON K1A 0B1, CA. Fetch the PDF.
    - expect: Text contains 'IRIS ISSUER<S>' upper-cased (upper-case the suffix when comparing), '77 MAPLE AVE', 'OTTAWA ON K1A0B1' (the postal code prints without its space), and 'CA'.

#### 1.11. Row 54: Authorized signature on the receipt

**File:** `tests/eo/issue-tax-receipt/row-54-authorized-signature.spec.ts`

**Steps:**
  1. Recipe R1 to R4 with one payment; fetch the PDF.
    - expect: Text contains 'Authorized Signature'. (The signature image itself cannot be read as text; the label is what is asserted.)

#### 1.12. Row 55: Unique receipt identifier on the receipt

**File:** `tests/eo/issue-tax-receipt/row-55-receipt-identifier.spec.ts`

**Steps:**
  1. Recipe R1 to R4 with two payments so two receipts are issued. Fetch both PDFs.
    - expect: Each text matches /Receipt No: GPO-00\d{6}/.
    - expect: The two identifiers on the PDFs are different, and each equals the number shown in its result row (never assert a literal number).

#### 1.13. Row 56: Contributor type on the receipt under the 'With contributor type' layout, then switch back to Original

**File:** `tests/eo/issue-tax-receipt/row-56-contributor-type-layout.spec.ts`

**Steps:**
  1. Prepare own data first (Recipe R1 to R3, one $50 payment) so the layout stays switched for the shortest time. Sign in as sysadmin and open /admin/receipts ('Receipt layout'). Note the radios are disabled until the reason has 3 or more characters, and choosing a radio saves immediately (there is no Save button).
    - expect: Radios 'Original' (selected) and 'With contributor type' are shown; both disabled while the reason is empty.
  2. Fill 'Reason (required to change the layout)' with 'E2E contributor type'. Choose 'With contributor type'.
    - expect: 'With contributor type' becomes selected; the reason field clears after the save.
  3. Wrap everything from here in try/finally. Sign out, sign in as cfo, issue the own space (R4). Fetch the PDF.
    - expect: Text contains 'Contributor Type: Individual' and still contains 'Contribution Type: Monetary'.
  4. Finally block: sign in as sysadmin, open /admin/receipts, fill a new reason (the field was cleared) 'E2E restore layout', choose 'Original'. Nothing else renders receipts while the layout is switched (the suite is serial).
    - expect: 'Original' is selected again.
  5. Open /admin/change-log (Change-log explorer), set Subject type to ReceiptSettings.
    - expect: Two entries, newest first: the switch back to Original (reason 'E2E restore layout') and the switch to the contributor-type layout (reason 'E2E contributor type'), actor System Administrator (the sysadmin user).
  6. Optional regression: issue one more own receipt as cfo (needs a second payment) after the switch-back and fetch the PDF.
    - expect: Text does NOT contain 'Contributor Type:'.

#### 1.14. Row 57: Contribution type on the receipt (Monetary vs Goods and Services)

**File:** `tests/eo/issue-tax-receipt/row-57-contribution-type.spec.ts`

**Steps:**
  1. Recipe R1 and R2. R3 payment A $50 monetary; R3 payment B $100 goods and services with Non-deductible ($) 20. Issue both (R4, 'One receipt per donor' OFF). Fetch both PDFs.
    - expect: Receipt A contains 'Contribution Type: Monetary'.
    - expect: Receipt B contains 'Contribution Type: Goods and Services'.

#### 1.15. Row 58: Political party name on the receipt

**File:** `tests/eo/issue-tax-receipt/row-58-party-name.spec.ts`

**Steps:**
  1. Recipe R1 to R4 with one payment; fetch the PDF.
    - expect: Text contains 'Green Party of Ontario'.

### 2. Receipt records and audit

**Seed:** `tests/seed.spec.ts`

#### 2.1. Row 42: Receipt records its allocation, an immutable address and name snapshot, and the stored PDF

**File:** `tests/eo/issue-tax-receipt/row-42-receipt-record.spec.ts`

**Steps:**
  1. Recipe R1 to R3 with ONE $50 payment on 2024-01-10, then R4 to issue. Remember the receipt number and the contribution link.
    - expect: '1 issued, 0 failed.'
  2. Open the contribution page /contributions/<id>.
    - expect: 'Allocations & receipts' row: the receipt number, ISSUED, $50.00 (the allocation of this contribution), today's issue date, 'View PDF'.
    - expect: 'Address on file' shows 77 Maple Ave, Ottawa ON K1A 0B1, CA.
  3. Fetch 'View PDF' twice (a stored PDF, not a re-render) and extract the text of both.
    - expect: Both responses are 200 PDFs and the extracted text is identical, with 'IRIS ISSUER<S>' and '77 MAPLE AVE'.
  4. As admin open the contributor record, choose 'Edit contributor', change Street to 'Elm Court' AND Last name to 'Renamed<S>' (the address stays complete), Reason 'E2E edit after issue', click 'Save changes' (disabled until the reason is filled).
    - expect: The record now shows 'Address: 77 Elm Court, Ottawa ON K1A 0B1, CA' and the new name; 'Change history' gains an entry.
  5. Fetch the ORIGINAL receipt's 'View PDF' again.
    - expect: The text is unchanged: it still prints '77 MAPLE AVE' and 'IRIS ISSUER<S>', and does not contain 'ELM COURT' or 'RENAMED'. The address and name were frozen at issuance.
  6. Contrast: as cfo, on the contribution page choose the receipt's 'Correct' menu then 'Reissue this receipt', fill Reason 'E2E reissue after address fix', keep the label, click Confirm. Fetch the replacement receipt's PDF.
    - expect: The replacement prints '77 ELM COURT' and 'RENAMED<S>' (current data), proving the old receipt kept its own snapshot.

#### 2.2. Row 44: The user who generated the receipt is recorded in the change log

**File:** `tests/eo/issue-tax-receipt/row-44-issued-by-user.spec.ts`

**Steps:**
  1. Recipe R1 to R4 with one payment and the run reason 'E2E issue <S>'. From the result row, take the receipt id from the 'View PDF' href (/api/receipts/<id>/pdf).
    - expect: Receipt id captured.
  2. Sign in as sysadmin, open /admin/change-log (Change-log explorer). Set Subject type to Receipt and Subject id to the receipt id.
    - expect: An entry with Subject 'Receipt (<id>)', Reason 'E2E issue <S>', and Actor 'Party CFO' (the cfo user's display name), Changes 'Created'. Issuing writes two such entries with the same reason (the receipt, then its PDF artifact); click the one whose dialog has a 'receiptNumber' field: it shows the receipt number and the amount (for example amountCents 5000) as After.
  3. Also open the contribution page as cfo and expand 'Show N changes' under 'Change history'.
    - expect: The issuance reason 'E2E issue <S>' is listed.

#### 2.3. Row 45: Date and time the receipt was generated

**File:** `tests/eo/issue-tax-receipt/row-45-issued-date-time.spec.ts`

**Steps:**
  1. Record `t0 = Date.now()`, run Recipe R1 to R4 with one payment, record `t1 = Date.now()`.
    - expect: '1 issued, 0 failed.'
  2. On the contribution page read the receipt row's issue date; as sysadmin open /admin/change-log filtered by Subject type Receipt and the receipt id.
    - expect: The row's issue date equals today's local date (locale formatted) and the PDF prints 'Issue Date: <today UTC>'.
    - expect: The 'At' timestamp in the dialog of the issuance entry (the one with a 'receiptNumber' field; rendered with toLocaleString) parses to a time between t0 and t1 (allow a minute of slack).

### 3. Corrections: lost, cancel, reissue

**Seed:** `tests/seed.spec.ts`

#### 3.1. Row 59: A receipt can be set to lost (Lost Lena read-only, plus a live lost reprint)

**File:** `tests/eo/issue-tax-receipt/row-59-lost-status.spec.ts`

**Steps:**
  1. Read-only fixture. As cfo open the contributor 'Lost Lena' (9503 PARTY, $45.00) and her contribution; take the receipt id from the 'View PDF' href.
    - expect: One receipt row, status ISSUED (a lost receipt stays valid; this screen shows no separate 'lost' column).
  2. As sysadmin open /admin/change-log, Subject type Receipt, Subject id <receipt id>.
    - expect: An entry whose Changes cell reads 'lost' and whose dialog shows Before 'false' and After 'true', and a reprint entry (Changes 'Created') whose dialog shows a 'kind' of LOST_COPY.
  3. Live. Recipe R1 to R4 with one $50 payment (own data). On the contribution page open the receipt's 'Correct' button (its accessible name is 'Correct receipt GPO-...') and choose the menu item 'Reprint as a lost-receipt copy'.
    - expect: A modal titled 'Reprint as a lost-receipt copy: GPO-...' explaining it reprints unaltered, stamped COPY, and that the receipt stays valid; Received-by label prefilled 'Green Party of Ontario'; Confirm disabled until a reason of 3 or more characters is filled.
  4. Fill reason 'E2E lost' and click Confirm.
    - expect: The modal shows 'Copy generated; the original is flagged lost.'
    - expect: After closing, the receipt row is still ISSUED and the 'Cancel' and 'Reissue' options remain available.
  5. As sysadmin check the change log for the receipt id.
    - expect: An entry reason 'E2E lost' whose Changes cell reads 'lost' and whose dialog shows Before 'false' and After 'true'.

#### 3.2. Row 60: The lost-receipt reprint is stamped COPY

**File:** `tests/eo/issue-tax-receipt/row-60-lost-copy-stamp.spec.ts`

**Steps:**
  1. Recipe R1 to R4 with one payment, then the 'Reprint as a lost-receipt copy' action as in Row 59 (reason 'E2E lost copy'). Capture the POST /api/receipts/<id>/reprint response (the 201 body has reprintId) via page.waitForResponse registered before clicking Confirm. NOTE: the UI has no link to the reprint PDF, so it is read through the API.
    - expect: Response 201 with kind LOST_COPY and lost true.
  2. GET /api/receipts/<id>/reprints/<reprintId>/pdf with page.request and extract its text.
    - expect: Text contains 'COPY' and the same receipt number as the original.
    - expect: The original receipt's own 'View PDF' text does NOT contain 'COPY'.
  3. Read-only cross-check with Lost Lena (9503): take her receipt id from the 'View PDF' href, GET /api/receipts/<id>/reprints (JSON data array, first entry kind LOST_COPY), then GET its /pdf.
    - expect: The reprint text contains 'COPY'. Nothing is changed.

#### 3.3. Row 61: A receipt can be cancelled and keeps its number

**File:** `tests/eo/issue-tax-receipt/row-61-cancel-receipt.spec.ts`

**Steps:**
  1. Recipe R1 to R4 with one $50 payment. Open the contribution page; note the receipt number and that 'Left to receipt' for the contributor is $0.00.
    - expect: Receipt row status ISSUED; 'Issue a receipt' button is disabled (nothing left to receipt).
  2. Open the receipt's 'Correct' menu, choose 'Cancel this receipt'.
    - expect: Modal 'Cancel this receipt: GPO-...' explaining the number is kept and a watermarked notice is stored; Confirm is disabled until the reason has 3 or more characters.
  3. Fill reason 'E2E cancel' and click Confirm. Close the modal if it stays open.
    - expect: The receipt row now reads the SAME receipt number with status CANCELLED.
    - expect: The 'Correct' button is gone for this row.
    - expect: The 'Issue a receipt' button is enabled again (the amount can be receipted again).
  4. As sysadmin check /admin/change-log for the receipt id.
    - expect: Entries with reason 'E2E cancel' (the cancel logs more than one); the one whose Changes cell lists 'status' has a dialog showing Before 'ISSUED' and After 'CANCELLED'.

#### 3.4. Row 62: Cancellation notice opens the CANCELLED copy and Email to donor queues it

**File:** `tests/eo/issue-tax-receipt/row-62-cancellation-notice.spec.ts`

**Steps:**
  1. Recipe R1 to R4 with one $50 payment (the contributor has an email on file). As cfo cancel the receipt as in Row 61 (reason 'E2E cancel'). Close the modal.
    - expect: The row shows 'View PDF', a 'Cancellation notice' link, and an 'Email to donor' button (it appears only with an email on file and the Correct receipts permission).
  2. Take the 'Cancellation notice' href (/api/receipts/<id>/cancellation-notice), fetch it with page.request, and extract text.
    - expect: Status 200 PDF whose text contains 'CANCELLED' and the cancelled receipt's number.
  3. Click 'Email to donor'.
    - expect: Modal 'Email the cancellation notice: GPO-...' stating it queues an email to the contributor's address; fields Subject (prefilled 'Your tax receipt has been cancelled'), Letter, 'Reason (required)'; 'Queue email' disabled until Letter and a reason of 3 or more characters are filled.
  4. Fill Letter 'Your receipt was cancelled; the cancelled copy is attached.' and reason 'E2E notice', click 'Queue email'.
    - expect: The modal closes and the row now shows 'queued to iris.<S>@e2e.test' (it later changes to 'sent to ... (simulated)'); the 'Email to donor' button is gone (a notice is emailed once).
  5. Sign in as sysadmin, open /admin/emails, set the Kind filter to 'Cancellation notice' and Search for the contributor's email.
    - expect: A row for 'Iris Issuer<S>', 'Receipt GPO-...', 'Your tax receipt has been cancelled', status SENT and SIMULATED (the background sender picks it up within seconds; use 'Send queued now' then Refresh if still QUEUED).
  6. Click the row.
    - expect: Detail shows Provider dev, 'Attached receipt PDF', and the letter text 'Re: Receipt GPO-...' with the typed letter.

#### 3.5. Row 63: Reissue replaces a receipt and says 'This cancels and replaces receipt #...'

**File:** `tests/eo/issue-tax-receipt/row-63-reissue-receipt.spec.ts`

**Steps:**
  1. Read-only fixture. As cfo open Reissued Rory (9503 PARTY, $60.00) and his contribution. Do not click anything in the Correct or Email to donor controls.
    - expect: Two receipt rows: an older number with status CANCELLED and a newer number with status ISSUED, both $60.00.
  2. Fetch the newer receipt's 'View PDF' and extract text.
    - expect: Contains 'This cancels and replaces receipt #' followed by the CANCELLED row's number (read it from the page).
  3. Live. Recipe R1 to R4 with one $50 payment. On the contribution page choose the receipt's 'Correct' menu then 'Reissue this receipt'.
    - expect: Modal 'Reissue this receipt: GPO-...' explaining it cancels and issues a replacement from current data; Received-by label prefilled; Confirm disabled until a reason is filled.
  4. Fill reason 'E2E reissue' and click Confirm.
    - expect: The modal shows 'Reissued as GPO-00######.'
    - expect: The contribution page lists two rows: the original CANCELLED and the new number ISSUED, and the new number is the original plus a later sequence number.
  5. Fetch the new receipt's PDF.
    - expect: Contains 'This cancels and replaces receipt #<original number>' and 'Eligible Amount: $50.00'.

### 4. Delivery

**Seed:** `tests/seed.spec.ts`

#### 4.1. Row 64: Emailed receipt is queued from Deliver and appears in Admin > Emails with the PDF attached

**File:** `tests/eo/issue-tax-receipt/row-64-email-delivery.spec.ts`

**Steps:**
  1. Read-only: Email Emma. As cfo open /spaces/9503/PARTY/issue, click 'Go to delivery' (the review shows 'Nothing to issue'). Do NOT type a letter or send.
    - expect: Deliver shows Email 'Ready to send' 1 (Emma has an EMAIL preference and an email on file) and the 'Send 1 email(s)' button is disabled (no letter or reason).
  2. Live, own data. Recipe R1 and R2, one $50 payment (R3). As cfo open the own space, Next: generate, set the 'Delivery override' select to 'Force email for all' (a donor's preference can otherwise only be set by the donor pre-check link), fill the run reason, Generate.
    - expect: '1 issued, 0 failed.' and the Deliver section appears with Email 'Ready to send' 1 and Mail 'Ready to print' 0.
  3. Fill the cover 'Letter' 'Thank you for your support.', the 'Reason (required)' 'E2E deliver', keep Subject 'Your official contribution receipt'. 'Send 1 email(s)' stays disabled until the letter and reason are filled; then click it.
    - expect: The Ready to send count drops to 0 and Sending, Sent, or Delivered rises to 1 (poll for a few seconds; sending is background and simulated).
  4. Sign in as sysadmin, open /admin/emails, Search for the contributor's email, Kind 'Receipt'.
    - expect: A row: 'Iris Issuer<S>', iris.<S>@e2e.test, 'Receipt GPO-...', 'Your official contribution receipt', status SENT with SIMULATED (page banner 'SIMULATED: NOTHING IS SENT').
  5. Click the row.
    - expect: Detail shows Provider dev, a 'Message id' starting 'simulated_', 'Attached receipt PDF', and 'Re: Receipt GPO-...' with 'Thank you for your support.'
  6. Back as cfo open the contribution page.
    - expect: The receipt row is unchanged (number, ISSUED, same View PDF text): sending an email does not alter the receipt.

#### 4.2. Row 65: Contributor email is held on the contributor record and is editable when tool-owned

**File:** `tests/eo/issue-tax-receipt/row-65-contributor-email.spec.ts`

**Steps:**
  1. Read-only: sign in as admin, open /contributors and find Email Emma (Email column 'email.emma@g4.fixture.test', Kept in 'This tool'). Open her record.
    - expect: 'Email: email.emma@g4.fixture.test', 'Qomon contact: none (kept in this tool)'
  2. Click 'Edit contributor', read the Email field, then click Cancel. Do NOT save.
    - expect: The Email textbox is prefilled with email.emma@g4.fixture.test and is editable (not disabled); 'Save changes' is disabled while the reason is empty.
  3. Own data. Recipe R2 (contributor with email iris.<S>@e2e.test), open 'Edit contributor', change Email to 'iris.<S>.new@e2e.test', Reason 'E2E email change', click 'Save changes'.
    - expect: The record shows 'Email: iris.<S>.new@e2e.test' and the Contributors list shows the new address; Change history gains an entry.
