# EO evaluation: Contributors

## Application Overview

Covers EO checklist rows 20-23 (unique contributor id, name, address, and Individual type). Qomon is off in e2e, so contributors added in the tool are tool-owned (Kept in "This tool") and editable. Group 1 to 3 fixtures carry a Qomon contact id and are shown read-only. Group 4 fixtures (e.g. Email Emma, period 9503) are read only here. Every edit targets a contributor the scenario creates with a unique suffix. Use `const sfx = Date.now().toString(36)`. Sign in with `signIn(page, 'admin')` (admin has Add and edit contributors and can record payments; 'filer' sees no Add/Edit buttons). Contributor ids are assigned from a shared counter (T42, T43...), so never assert a literal T number; assert /^T\d+$/ and compare two ids. Dialogs: submit buttons stay [disabled] until required fields are valid and a reason is entered, so negative checks assert `toBeDisabled()` and never click. Address is all-or-nothing: street, city, province, postal code, and country together, or all blank (street number optional). Validation message: "Fill in the street, city, province, postal code, and country, or leave the address blank." Payments: every payment these scenarios record sets Received on to 2025-03-15 and the Contribution block's Period to '2025 General Election' (period 64, window 2025-01-27 to 2025-05-28, used by no fixture), so they never land in the 2026 Annual space other sections assert on and raise no A1 work item.

## Test Scenarios

### 1. Row 20-23: Contributors

**Seed:** `apps/tax-receipts/e2e/tests/seed.spec.ts`

#### 1.1. Row 20: Every contributor shows a Contributor id, and Qomon contacts show their Qomon contact id

**File:** `tests/eo/contributors/row-20-contributor-id-display.spec.ts`

**Steps:**
  1. Mutates: nothing (reads fixtures Baseline Donor and Email Emma only). Sign in as admin. Go to /contributors. Click the link 'Baseline Donor' (row shows Kept in 'Qomon').
    - expect: Heading 'Baseline Donor' is shown
    - expect: Text 'Contributor id: 800001' and 'Qomon contact: 800001' are shown (for a Qomon contact the id EO files carry is the Qomon contact id)
    - expect: Banner 'This is a Qomon contact and Qomon is not connected here, so it cannot be edited in this tool.' is shown
    - expect: No 'Edit contributor' button exists on the page (read-only assertion allowed for Group 1-3 fixtures)
  2. Go to /contributors and click the link 'Email Emma' (Kept in 'This tool'). Do not edit.
    - expect: 'Contributor id: ' followed by T and digits (currently T40; assert regex /Contributor id: T\d+/)
    - expect: 'Qomon contact: none (kept in this tool)'

#### 1.2. Row 20: Contributor id is system-assigned, differs between two contributors added back to back, and cannot be edited

**File:** `tests/eo/contributors/row-20-contributor-id-unique-immutable.spec.ts`

**Steps:**
  1. Mutates: creates two contributors 'Ida <sfx>-A' and 'Ida <sfx>-B' (first name 'Ida', last names 'Unique<sfx>A' and 'Unique<sfx>B'). Sign in as admin, go to /contributors, click 'Add a contributor'. Dialog 'Add a contributor' opens. Confirm the dialog has no field labelled 'Contributor id' (fields: First name, Last name, Email, Contributor type, Street number, Street, City, Province, Postal code, Country, Reason (required)).
    - expect: Dialog has no Contributor id input
    - expect: Add contributor button is [disabled]
  2. Fill First name 'Ida', Last name 'Unique<sfx>A', Reason 'E2E row 20 first contributor'. Leave email and address blank (valid). Click 'Add contributor' once it is enabled.
    - expect: Browser navigates to /contributors/<id> with heading 'Ida Unique<sfx>A'
    - expect: 'Contributor id: T<n>' is shown; record the value as idA
    - expect: 'Qomon contact: none (kept in this tool)'
    - expect: 'Address' line is absent or shows no address; Change history shows 'Show 1 change'
  3. Go back to /contributors, click 'Add a contributor' again, fill First name 'Ida', Last name 'Unique<sfx>B', Reason 'E2E row 20 second contributor', click 'Add contributor'.
    - expect: New record shows 'Contributor id: T<m>' and m differs from idA (it is the next number up, but assert only inequality)
  4. On the second record click 'Edit contributor'. Inspect the dialog 'Edit Ida Unique<sfx>B'.
    - expect: Dialog fields are First name, Last name, Email, Contributor type, Street number, Street, City, Province, Postal code, Country, Reason (required); there is no Contributor id or Qomon contact field
    - expect: Save changes is [disabled] (nothing changed, no reason)
  5. Change First name to 'Idabel', enter Reason 'E2E row 20 rename'. Confirm Save changes is enabled, then click it.
    - expect: Name in heading becomes 'Idabel Unique<sfx>B'
    - expect: 'Contributor id' is unchanged and still equals idB (id survives the edit)
  6. Click the button 'Show 2 changes' in Change history.
    - expect: Both history entries show the same contributorId in their before/after JSON

#### 1.3. Row 21: Add a contributor from the Contributors page with first and last name recorded separately, then edit the name with a reason

**File:** `tests/eo/contributors/row-21-add-and-edit-name.spec.ts`

**Steps:**
  1. Mutates: creates contributor 'Ada Lovelace-<sfx>' and renames the first name to 'Augusta'. Sign in as admin, go to /contributors, click 'Add a contributor'.
    - expect: Dialog 'Add a contributor' opens
    - expect: Add contributor button is [disabled]
  2. Negative: fill only First name 'Ada' and Reason 'New donor added at event'. Snapshot the dialog.
    - expect: Add contributor stays [disabled] (Last name is required)
  3. Add Last name 'Lovelace-<sfx>'. Clear the Reason field (or use a fresh dialog with names filled and no reason). Snapshot.
    - expect: Add contributor is [disabled] while Reason is empty
  4. Negative: clear First name (leave Last name and Reason). Snapshot.
    - expect: Add contributor is [disabled] when First name is missing
  5. Fill First name 'Ada', Last name 'Lovelace-<sfx>', Email 'ada.<sfx>@example.test', Reason 'New donor added at event'. Leave address blank. Click 'Add contributor' once enabled.
    - expect: Navigates to /contributors/<id>, heading 'Ada Lovelace-<sfx>'
    - expect: 'First name: Ada' and 'Last name: Lovelace-<sfx>' shown on separate lines
    - expect: 'Kept in' badge 'This tool'; 'Email: ada.<sfx>@example.test'
  6. Click 'Edit contributor'. Change First name to 'Augusta'. Snapshot with Reason empty.
    - expect: Save changes is [disabled] until a reason is entered
  7. Enter Reason 'Corrected first name spelling', confirm Save changes is enabled, click it. Then click 'Show 2 changes' (button text becomes 'Hide' after expanding).
    - expect: Heading 'Augusta Lovelace-<sfx>'; 'First name: Augusta'
    - expect: Change history table (columns At, By, Reason, Before, After) has a row with By 'Receipt Administrator', Reason 'Corrected first name spelling', Before JSON containing "firstName":"Ada" and After JSON containing "firstName":"Augusta"
    - expect: A second row with Reason 'New donor added at event' and Before '—'
  8. Go to /contributors and type '<sfx>' in the Search box (needs two or more letters).
    - expect: Table shows one row 'Augusta Lovelace-<sfx>' with Kept in 'This tool'

#### 1.4. Row 21: Add a new contributor from the New payment form records the name

**File:** `tests/eo/contributors/row-21-add-from-payment-form.spec.ts`

**Steps:**
  1. Mutates: creates contributor 'Grace Hopper-<sfx>' (with address) and one $50 cheque payment and contribution for it. Sign in as admin and go to /payments/new (heading 'Add a payment').
    - expect: Button 'Not on file? Add a new contributor' is visible
  2. Click 'Not on file? Add a new contributor'. In the dialog (scope locators with getByRole('dialog')), fill First name 'Grace', Last name 'Hopper-<sfx>', Street number '77', Street 'Queen St W', City 'Ottawa', leave Province 'ON', Postal code 'K1A 0B1', Country 'CA', Reason 'Donor walked in with a cheque'. Confirm Add contributor is enabled, click it.
    - expect: Dialog closes; the payment form's Contribution donor reads 'Donor (blank = Grace Hopper-<sfx>)'
  3. Fill the first Amount ($) with '50', set Received on to 2025-03-15 and Period to '2025 General Election', leave Method 'Cheque', fill Reason (required) 'Cheque received at office'. Confirm 'Save payment' is enabled and click it.
    - expect: Heading 'Payment recorded' and text 'The payment and its contribution were recorded.'
    - expect: Link 'Open the contribution' is visible
  4. Click 'Open the contribution'. Under Contribution read the Donor field.
    - expect: Donor shows 'Grace Hopper-<sfx>' on the Payment section ('Donor who paid') and on the Contribution section
  5. Go to /contributors, search '<sfx>', open 'Grace Hopper-<sfx>'.
    - expect: 'First name: Grace' and 'Last name: Hopper-<sfx>' on separate lines
    - expect: Contributions table lists one row, $50.00, PARTY, ACTIVE

#### 1.5. Row 22: Contributor address is recorded in structured parts, enforced all-or-nothing, and shown on the record and the contribution detail

**File:** `tests/eo/contributors/row-22-address-recorded.spec.ts`

**Steps:**
  1. Mutates: creates contributor 'Edith Address-<sfx>' and one $25 cheque contribution for it via /payments/new. Sign in as admin, go to /contributors, click 'Add a contributor'. Fill First name 'Edith', Last name 'Address-<sfx>', Reason 'E2E row 22'.
    - expect: Add contributor is enabled with the address blank (optional); helper text 'Optional here, but a receipt cannot be issued without one.' is visible
    - expect: Province select defaults to 'ON' and lists ON AB BC MB NB NL NS NT NU PE QC SK YT; Country defaults to 'CA'
  2. Negative: fill only Street 'Elm St' (street number, city, and postal code blank). Snapshot.
    - expect: Message 'Fill in the street, city, province, postal code, and country, or leave the address blank.' is visible
    - expect: Add contributor is [disabled]; do not click it
  3. Negative: add City 'Toronto' but leave Postal code blank. Snapshot.
    - expect: The same message is still visible and Add contributor remains [disabled]
  4. Fill Street number '10', Postal code 'M5V 2T6' (Street 'Elm St', City 'Toronto', Province ON, Country CA are set). Snapshot.
    - expect: The 'Fill in the street...' message disappears and Add contributor is enabled
  5. Click 'Add contributor'.
    - expect: Record page shows 'Address: 10 Elm St, Toronto ON M5V 2T6, CA'
  6. Click 'Edit contributor'. Confirm the fields are pre-filled (Street number '10', Street 'Elm St', City 'Toronto', Province 'ON', Postal code 'M5V 2T6', Country 'CA'). Change City to 'Ottawa' and Postal code to 'K1A 0B1', Reason 'E2E row 22 move', and Save changes (enabled). Then clear Street only in a second Edit contributor dialog and snapshot.
    - expect: After saving, record shows 'Address: 10 Elm St, Ottawa ON K1A 0B1, CA'
    - expect: In the second dialog with Street cleared and city/postal still filled, the 'Fill in the street...' message appears and Save changes is [disabled]; click Cancel
  7. Go to /payments/new, use the Donor who paid search to type 'Address-<sfx>' and choose 'Edith Address-<sfx>'. Enter Amount '25', Received on 2025-03-15, Period '2025 General Election', Reason 'E2E row 22 payment', Save payment, then click 'Open the contribution'.
    - expect: Contribution page has 'Address on file' with value '10 Elm St, Ottawa ON K1A 0B1, CA'

#### 1.6. Row 23: Contributor type is Individual and read-only everywhere it appears

**File:** `tests/eo/contributors/row-23-individual-type.spec.ts`

**Steps:**
  1. Mutates: creates contributor 'Tess Individual-<sfx>' and one $20 cheque contribution for it. Sign in as admin, go to /contributors, click 'Add a contributor'.
    - expect: Field 'Contributor type' is present with value 'Individual' and is read-only (readOnly attribute true; typing does not change it)
    - expect: Note 'Ontario accepts political contributions from individuals only.' is visible
  2. Fill First name 'Tess', Last name 'Individual-<sfx>', Reason 'E2E row 23' and click 'Add contributor' once enabled.
    - expect: Record shows 'Contributor type: Individual'
  3. Click 'Edit contributor'.
    - expect: Edit dialog shows read-only 'Contributor type' = 'Individual' and the same Ontario note; click Cancel
  4. Go to /payments/new, pick donor 'Tess Individual-<sfx>', Amount '20', Received on 2025-03-15, Period '2025 General Election', Reason 'E2E row 23 payment', Save payment, 'Open the contribution'.
    - expect: Contribution section Donor shows 'Individual, contributor id T<n>' under the donor name, where T<n> matches the id on the contributor record
  5. Read-only comparison: open the fixture 'Baseline Donor' record at /contributors (click its link) and 'Email Emma'.
    - expect: Both show 'Contributor type: Individual' (Qomon-owned and tool-owned alike)
