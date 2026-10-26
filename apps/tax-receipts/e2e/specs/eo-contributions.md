# EO evaluation: Contributions

## Application Overview

Rows 24-31 of the Elections Ontario evaluation checklist for the GPO Tax Receipts and Contributions tool. Fixture scenarios read the Group 4 contributions in period 9503 (Fixture - EO evaluation) and By-Election Donor in 9501 and change nothing. "Live" scenarios sign in as admin, create their own contributor and payment, and record them in period 64 (2025 General Election; window starts 2025-01-27 and ends 2025-05-28, shown in Admin > Periods as 1/27/2025 to 5/28/2025) with an accepted date inside it. The scenarios use 2025-03-15 and leave the Period select on "Derived from the date", which resolves to 2025 General Election. Verified in the live app: period 64 accepts party, leadership contestant, and CA riding 121 contributions and splits with no work items. Every scenario starts signed out and signs in with signIn(page, '<user>') from tests/helpers.ts. Actual UI wording differs from the checklist text: the contribution detail has no "Agency contribution: Yes/No" field; agency shows as a grape "agency" badge beside the Recipient value (hover shows the AGENCY_HELP tooltip), and a non-agency contribution has no badge. The split block reads "Split across N contributions:" and the leadership recipient reads "Leadership contestant: <name>". The contribution id is not a labelled field; it is the last segment of the /contributions/<id> URL. Contribution rows are reached from Contributions list links (hrefs vary per seeded run, so locate rows by donor name and amount, not by id).

## Test Scenarios

### 1. Contributions (rows 24-31)

**Seed:** `tests/seed.spec.ts`

#### 1.1. Row 24: Each contribution has a unique id shown in its detail URL

**File:** `tests/eo/contributions/row-24-unique-id.spec.ts`

**Steps:**
  1. Sign in as admin. Mutates: nothing (reads seeded Group 4 contributions Agency Alex $150.00 and Direct Dee $120.00, both period 9503).
    - expect: The Contributions page (/contributions) loads with the heading 'Contributions' and a table with columns Date, Donor, Amount, Period, Riding, Entity, Received by, Agency, Source code, Non-deductible, Receipt, Open flags.
  2. In the table, click the 'Agency Alex' link in the row with amount $150.00 and period 9503. Record the URL.
    - expect: The URL matches /contributions/<id> where <id> is a non-empty token (a cuid such as cmve...).
    - expect: The page heading is 'Contribution' and the Contribution card shows Donor 'Agency Alex' with 'Individual, contributor id T<n>'.
  3. Click '← Back to list', then click the 'Direct Dee' link in the row with amount $120.00 and period 9503. Record the URL.
    - expect: The URL is /contributions/<other-id>.
    - expect: The second id differs from the first id (two contributions have different ids).
  4. Reload the first URL directly.
    - expect: The same contribution (Agency Alex, $150.00) loads, showing the id is a stable identifier.

#### 1.2. Row 25: Entity column identifies party, association, campaign, and leadership contestant

**File:** `tests/eo/contributions/row-25-entity-fixtures.spec.ts`

**Steps:**
  1. Sign in as admin. Mutates: nothing (reads Split Sam, Agency Alex, Leadership Lee in period 9503 and By-Election Donor in 9501; opens an edit modal on Leadership Pat and cancels it).
    - expect: Contributions list loads.
  2. In the Contributions list, find the row Split Sam $300.00 (period 9503).
    - expect: Entity cell shows 'PARTY'; Riding cell shows an em dash.
  3. Find the row Agency Alex $150.00 (period 9503).
    - expect: Entity cell shows 'CA'; Riding cell shows '121'.
  4. Find the row Leadership Lee $250.00 (period 9503).
    - expect: Entity cell shows 'LEADERSHIP: Jordan Rivers'.
  5. Find the row By-Election Donor $50.00 (period 9501).
    - expect: Entity cell shows 'CAMPAIGN'; Riding cell shows '121'; Period cell shows '9501'.
  6. Use the Entity kind filter to choose 'Leadership contestant'.
    - expect: The list narrows to LEADERSHIP rows only (Leadership Lee, Leadership Lou, Leadership Pat, and the Leadership Import Donor row) and the Entity kind filter lists 'Party (province-wide)', 'Constituency association', 'Campaign', 'Leadership contestant'.
  7. Open Leadership Lee (click the link in the row). Read the Recipient field of the Contribution card.
    - expect: Recipient reads 'Leadership contestant: Jordan Rivers'.
    - expect: The Edit button on the Contribution card is disabled (this contribution backs an issued receipt); do NOT click it. Hovering its wrapper shows the tooltip 'This contribution backs an issued receipt; change it with Correct instead.'
  8. Go back and open Leadership Pat (a Group 4 leadership contribution with no issued receipt, $75.00). Confirm the Edit button in the Contribution card is enabled in the snapshot, then click it.
    - expect: An 'Edit contribution' modal opens with Recipient set to 'Leadership contestant' and a 'Leadership contestant' picker showing 'Jordan Rivers (Fixture leadership contest (not real))'.
    - expect: The 'Save contribution' button is disabled.
  9. Click the contestant picker.
    - expect: The options include 'Jordan Rivers (Fixture leadership contest (not real))' and 'Sam Okafor (Fixture leadership contest (not real))'.
  10. Click Cancel in the modal. Do not save.
    - expect: The modal closes and the Recipient still reads 'Leadership contestant: Jordan Rivers'.
  11. Sign in as sysadmin with switchUser (admin@ lacks settings access, so its Admin menu has no 'Leadership contestants'), navigate to Admin (/admin) and click 'Leadership contestants' in the side navigation (/admin/leadership-contestants).
    - expect: The registry table with columns Contestant, Contest, Status lists 'Jordan Rivers' and 'Sam Okafor', both with contest 'Fixture leadership contest (not real)' and status ACTIVE. Do not click 'Make inactive'.

#### 1.3. Row 25: Live: payment directed to a leadership contestant

**File:** `tests/eo/contributions/row-25-live-leadership.spec.ts`

**Steps:**
  1. Sign in as admin. Mutates: creates contributor 'Contrib Leader <timestamp>' and one $500.00 payment/contribution in period 64 dated 2025-03-15. Reads the seeded contestant Jordan Rivers.
    - expect: Signed in.
  2. Go to /payments/new. Click 'Not on file? Add a new contributor'. In the 'Add a contributor' dialog fill First name 'Contrib', Last name 'Leader<timestamp>', and fill the address all together: Street number '10', Street 'Queen St', City 'Toronto', Postal code 'M5V 2T6' (Province ON and Country CA are prefilled; leave them), and Reason 'e2e leadership'. Confirm 'Add contributor' is enabled in the snapshot, then click it.
    - expect: The dialog closes and 'Donor who paid' shows the new contributor name.
  3. Fill the payment Amount ($) with 500 and Received on with 2025-03-15. Leave Method as Cheque.
    - expect: The Contribution block says 'Covers the whole payment ($500.00)...' and its Amount ($) is disabled and shows 500.
  4. In the Contribution block choose Recipient 'Leadership contestant'.
    - expect: A 'Leadership contestant' picker (placeholder 'Choose a contestant') replaces the Riding field.
    - expect: Period shows 'Derived from the date: 2025 General Election' and the Received by help text reads 'Agency contribution: GPO received it for another entity'.
  5. Click the contestant picker and choose 'Jordan Rivers (Fixture leadership contest (not real))'. Fill Reason (required) with 'e2e leadership'. Check that 'Save payment' is not marked [disabled], then click it.
    - expect: The page shows 'Payment recorded', 'The payment and its contribution were recorded.' and an 'Open the contribution' link.
  6. Click 'Open the contribution'.
    - expect: URL is /contributions/<id>.
    - expect: Recipient reads 'Leadership contestant: Jordan Rivers' with an 'agency' badge; Period reads '2025 General Election'; Accepted on reads 3/15/2025; Work items shows 'None.'

#### 1.4. Row 26: Agency contribution flag on fixtures, list column, and filter

**File:** `tests/eo/contributions/row-26-agency-fixtures.spec.ts`

**Steps:**
  1. Sign in as admin. Mutates: nothing (reads Agency Alex, Direct Dee, Leadership Lou in period 9503).
    - expect: Signed in.
  2. Open Contributions, then open the Agency Alex $150.00 row.
    - expect: Recipient reads 'Constituency association, riding 121' followed by an 'agency' badge.
    - expect: Received by reads 'GPO (party office, central)'.
  3. Hover the 'agency' badge.
    - expect: A tooltip appears starting 'An agency contribution is one the party (GPO) received on behalf of another entity' and ending 'it files as Agency_Contribution = Y in the ALL report.'
  4. Go back and open the Direct Dee $120.00 row (CA riding 121, received by the CA).
    - expect: Recipient reads 'Constituency association, riding 121' with no 'agency' badge.
    - expect: Received by reads as the entity/subspace option, not GPO.
  5. Go back and open the Leadership Lou $100.00 row.
    - expect: Recipient reads 'Leadership contestant: Sam Okafor' with an 'agency' badge.
  6. On the Contributions list, confirm the Agency column: Agency Alex row shows 'agency'; Direct Dee row shows 'ENTITY' under Received by and a dash under Agency; Leadership Lou row shows 'agency'.
    - expect: Agency column values match the detail pages.
  7. Click 'Show advanced filters' and set 'Agency contribution' to 'Agency only'.
    - expect: Every visible row has 'agency' in the Agency column; Agency Alex, Leadership Lou, Leadership Pat and the CA half of Split Sam appear; Direct Dee does not.
  8. Change 'Agency contribution' to 'Not agency'.
    - expect: No row shows 'agency'; Direct Dee appears; Agency Alex does not.

#### 1.5. Row 26: Live: agency is derived from received-by and recipient

**File:** `tests/eo/contributions/row-26-live-agency-derivation.spec.ts`

**Steps:**
  1. Sign in as admin. Mutates: creates contributor 'Agency Live <timestamp>' and one $200.00 payment in period 64 dated 2025-03-15 (CA riding 121).
    - expect: Signed in.
  2. Go to /payments/new, add a new contributor (First 'Agency', Last 'Live<timestamp>', Street number '12', Street 'Queen St', City 'Toronto', Postal code 'M5V 2T6', Reason 'e2e agency'; click Add contributor once it is enabled). Fill Amount 200 and Received on 2025-03-15.
    - expect: Donor shows the new contributor.
  3. Choose Recipient 'Constituency association'. In the Riding field type '121' and click the option '121 · York—Simcoe'.
    - expect: Riding is set; with Received by 'GPO (party office, central)' the help text reads 'Agency contribution: GPO received it for another entity'.
  4. Change Received by to 'Entity / subspace entry'.
    - expect: The agency help text disappears.
  5. Change Received by back to 'GPO (party office, central)', fill Reason 'e2e agency', confirm 'Save payment' is enabled, and click it. Click 'Open the contribution'.
    - expect: Recipient reads 'Constituency association, riding 121' with an 'agency' badge; Period reads '2025 General Election'; Work items shows 'None.'

#### 1.6. Row 27: Total amount recorded on contribution and parent payment

**File:** `tests/eo/contributions/row-27-total-amount.spec.ts`

**Steps:**
  1. Sign in as admin. Mutates: nothing (reads Split Sam $300.00 and Agency Alex $150.00).
    - expect: Signed in.
  2. Open the Agency Alex $150.00 contribution (period 9503).
    - expect: The Payment card shows Amount '$150.00' and the Contribution card shows Amount '$150.00'.
    - expect: Allocations & receipts lists a receipt for $150.00.
  3. Go back and open the Split Sam $300.00 (Party) contribution.
    - expect: The Payment card Amount reads '$500.00' (total payment).
    - expect: The Contribution card Amount reads '$300.00' (this contribution).
    - expect: The split block lists $300.00 and $200.00, which sum to the payment total.

#### 1.7. Row 28: Split Sam payment is split across two entities with amounts

**File:** `tests/eo/contributions/row-28-split-fixture.spec.ts`

**Steps:**
  1. Sign in as admin. Mutates: nothing (reads both halves of Split Sam in period 9503).
    - expect: Signed in.
  2. On the Contributions list find the two 'Split Sam' rows ($300.00 PARTY and $200.00 CA riding 121) and open the $300.00 one.
    - expect: The Payment card shows Amount $500.00.
    - expect: Text 'Split across 2 contributions:' appears, listing 'this contribution' $300.00 'Party (province-wide)', and a link 'Split Sam' $200.00 'Constituency association, riding 121' with an 'agency' badge.
  3. Click the 'Split Sam' link in the split block.
    - expect: The $200.00 CA contribution opens: Recipient 'Constituency association, riding 121' with an 'agency' badge; the split block now marks this one as 'this contribution' and links the $300.00 half; the same Payment card ($500.00, note fixture-g4-3).
    - expect: Each half has its own receipt row under 'Allocations & receipts' (different receipt numbers, status ISSUED, $300.00 and $200.00).

#### 1.8. Row 28: Live: split one payment across party and a CA riding

**File:** `tests/eo/contributions/row-28-live-split.spec.ts`

**Steps:**
  1. Sign in as admin. Mutates: creates contributor 'Split Live <timestamp>' and one $500.00 payment with two contributions ($300 party, $200 CA riding 121) in period 64 dated 2025-03-16.
    - expect: Signed in.
  2. Go to /payments/new, add a new contributor (First 'Split', Last 'Live<timestamp>', Street number '11', Street 'Queen St', City 'Toronto', Postal code 'M5V 2T6', Reason 'e2e split'; click Add contributor once enabled). Fill Amount 500 and Received on 2025-03-16.
    - expect: Donor shows the new contributor.
  3. Click 'Split across more contributions'.
    - expect: Blocks 'Contribution 1' and 'Contribution 2' appear, each with a Remove button, plus 'Add another contribution'.
    - expect: A counter reads '$500.00 of $500.00 attributed' initially, and the Amount fields of the contributions are editable.
  4. Set Contribution 1 Amount to 300 (Recipient 'Party (province-wide)'). Set Contribution 2 Amount to 200, Recipient 'Constituency association', and Riding by typing '121' into the field with placeholder 'Type a riding number or name' and clicking '121 · York—Simcoe'.
    - expect: The counter reads '$500.00 of $500.00 attributed'.
  5. Fill Reason 'e2e split'. Confirm 'Save payment' is enabled, then click it.
    - expect: Page shows 'Payment recorded' and 'The payment and its 2 contributions were recorded.' with links 'Contribution 1 ($300.00)' and 'Contribution 2 ($200.00)'.
  6. Click 'Contribution 2 ($200.00)'.
    - expect: The Payment card shows $500.00 and 'Split across 2 contributions:' lists $300.00 'Party (province-wide)' and $200.00 'Constituency association, riding 121' with an 'agency' badge.
    - expect: Contribution Amount reads $200.00; Period '2025 General Election'; Work items 'None.'
  7. Negative: return to /payments/new, add nothing, and with an unbalanced split (leave the counter below the payment total) check the Save payment button.
    - expect: If 'Save payment' is marked [disabled] it stays unclicked; otherwise record the visible validation message. Do not save an unbalanced split.

#### 1.9. Row 29: Goods Gita shows goods and services with a non-deductible amount

**File:** `tests/eo/contributions/row-29-goods-fixture.spec.ts`

**Steps:**
  1. Sign in as admin. Mutates: nothing (reads Goods Gita $100.00, period 9503, and a monetary contribution Agency Alex for contrast).
    - expect: Signed in.
  2. On the Contributions list find the Goods Gita row.
    - expect: Amount $100.00; the Non-deductible column shows '$20.00'; other rows (Email Emma) show an em dash.
  3. Open Goods Gita.
    - expect: Amount '$100.00'; 'Donor received goods or services' reads 'Yes'; 'Non-deductible' reads '$20.00'; Recipient 'Party (province-wide)'.
  4. Go back and open Agency Alex for contrast.
    - expect: 'Donor received goods or services' reads 'No' and 'Non-deductible' reads '$0.00'.

#### 1.10. Row 29: Live: goods-and-services payment with a non-deductible amount

**File:** `tests/eo/contributions/row-29-live-goods.spec.ts`

**Steps:**
  1. Sign in as admin. Mutates: creates contributor 'Goods Live <timestamp>' and one $100.00 payment (non-deductible $20.00) in period 64 dated 2025-03-15.
    - expect: Signed in.
  2. Go to /payments/new, add a new contributor (First 'Goods', Last 'Live<timestamp>', Street number '13', Street 'Queen St', City 'Toronto', Postal code 'M5V 2T6', Reason 'e2e goods'; click Add contributor once enabled). Fill Amount 100 and Received on 2025-03-15.
    - expect: Donor shows the new contributor.
  3. Observe the Contribution block's 'Non-deductible ($)' field before ticking the checkbox.
    - expect: 'Non-deductible ($)' is disabled.
  4. Tick 'Donor received goods or services'.
    - expect: 'Non-deductible ($)' becomes enabled.
  5. Fill Non-deductible ($) with 20 and Reason 'e2e goods'. Confirm 'Save payment' is enabled and click it, then click 'Open the contribution'.
    - expect: 'Donor received goods or services' reads 'Yes'; 'Non-deductible' reads '$20.00'; Amount '$100.00'; Period '2025 General Election'.

#### 1.11. Row 30: Accepted date shows day, month, and year

**File:** `tests/eo/contributions/row-30-accepted-date.spec.ts`

**Steps:**
  1. Sign in as admin. Mutates: nothing (reads Agency Alex, accepted 3/1/2029, period 9503).
    - expect: Signed in.
  2. Open Contributions and find the Agency Alex row.
    - expect: The Date cell shows '3/1/2029' (month/day/year).
  3. Open the contribution.
    - expect: The Contribution card shows 'Accepted on' = '3/1/2029' and the Payment card 'Received on' = '3/1/2029'.

#### 1.12. Row 30: Live: a recorded contribution keeps its known accepted date

**File:** `tests/eo/contributions/row-30-live-accepted-date.spec.ts`

**Steps:**
  1. Sign in as admin. Mutates: creates contributor 'Dated Live <timestamp>' and one $50.00 payment in period 64 with Received on 2025-03-15 and Accepted on 2025-03-20.
    - expect: Signed in.
  2. Go to /payments/new, add a new contributor (First 'Dated', Last 'Live<timestamp>', Street number '14', Street 'Queen St', City 'Toronto', Postal code 'M5V 2T6', Reason 'e2e date'; click Add contributor once enabled). Fill Amount 50 and Received on 2025-03-15.
    - expect: Contribution 'Accepted on' help text reads 'blank = 2025-03-15'.
  3. Fill the contribution 'Accepted on' date with 2025-03-20 and Reason 'e2e date'. Confirm 'Save payment' is enabled and click it; click 'Open the contribution'.
    - expect: Payment 'Received on' reads 3/15/2025; Contribution 'Accepted on' reads 3/20/2025; Period '2025 General Election'; Work items 'None.'
  4. Go to the Contributions list and set 'Accepted from' and 'Accepted to' in the advanced filters to 2025-03-20, and Donor to the new contributor's name.
    - expect: The new contribution appears with Date cell '3/20/2025'.

#### 1.13. Row 31: Contribution period on the detail and as a list filter

**File:** `tests/eo/contributions/row-31-period.spec.ts`

**Steps:**
  1. Sign in as admin. Mutates: nothing (reads Group 4 rows in 9503 and By-Election Donor in 9501).
    - expect: Signed in.
  2. Open Contributions and read the Period column for Agency Alex and By-Election Donor.
    - expect: Agency Alex shows '9503'; By-Election Donor shows '9501'.
  3. Open the Agency Alex contribution.
    - expect: Period reads 'Fixture — EO evaluation (not a real EO period)'.
  4. Go back, open By-Election Donor ($50.00, period 9501).
    - expect: Period reads 'Fixture by-election (not a real EO period)'; Recipient 'Campaign, riding 121'.
  5. Go back to Contributions and use the Period filter: open it and choose the option 'Fixture — EO evaluation (not a real EO period)'.
    - expect: Only rows with Period '9503' remain (Agency Alex, Direct Dee, Split Sam x2, Goods Gita, Leadership rows, Threshold Theo, etc.); By-Election Donor is not listed.
  6. Change the Period filter to 'Fixture by-election (not a real EO period)'.
    - expect: Only 9501 rows appear (By-Election Donor, Campaign Cam, Rambling Randy $30.00); Agency Alex is not listed.
