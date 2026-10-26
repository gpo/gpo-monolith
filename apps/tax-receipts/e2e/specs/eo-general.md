# EO evaluation: General

## Application Overview

Elections Ontario evaluation checklist, section General (rows 1-2). Row 1 shows the custom web app as an electronic database: signed in as cfo@ it loads with its navigation, and a signed-out visit shows the sign-in form. Row 2 (relational database) lives in the Prisma schema on PostgreSQL; one light read-only UI scenario shows related records linked, and the integrity guarantees are covered by API tests, not the browser. All scenarios start signed out; logins are @gpo.test with password change-me-please-12345 via signIn(page, user) from tests/helpers.ts.

## Test Scenarios

### 1. General

**Seed:** `tests/seed.spec.ts`

#### 1.1. Row 1: Signed-in app loads with its navigation

**File:** `tests/eo/general/row-01-app-loads.spec.ts`

**Steps:**
  1. Shared data: reads seeded login cfo@gpo.test only. Mutates: nothing. Start signed out. Call signIn(page, 'cfo') (opens /login, fills Email and Password, clicks the 'Sign in' button).
    - expect: The 'Sign in' heading is hidden
    - expect: The app lands on / with the page title 'GPO Tax Receipts & Contributions'
  2. Inspect the top banner navigation.
    - expect: Links visible in the banner: 'Contributions' (/contributions), 'Contributors' (/contributors), 'Work queue' (/work-queue), 'RTD filings' (/rtd-filings), 'Admin' (/admin)
    - expect: The 'Green Party of Ontario' logo image links to /
    - expect: The 'Account menu' button is visible
  3. Inspect the main area of the home page.
    - expect: A level-2 heading 'Spaces' is visible
    - expect: A table with column headers 'Period', 'Riding', 'Entity', 'Stage', 'Stage owner', 'Contributions', 'Open flags' is shown
    - expect: The table has at least one data row, for example a '2026 Annual' row with Entity 'Party (province-wide)'
  4. Click the 'Contributions' navigation link.
    - expect: URL becomes /contributions
    - expect: A table of contributions loads with column headers including 'Date', 'Donor', 'Amount', 'Period', 'Entity', 'Receipt', and at least one row
  5. Click the 'Contributors' navigation link.
    - expect: URL becomes /contributors and a list of contributors loads

#### 1.2. Row 1: Signed-out visit shows the sign-in form

**File:** `tests/eo/general/row-01-signed-out-login.spec.ts`

**Steps:**
  1. Shared data: none. Mutates: nothing. In a fresh signed-out context, go to /contributions directly.
    - expect: The 'Sign in' heading (level 3) is visible with an 'Email' textbox and a 'Password' textbox and a 'Sign in' button
    - expect: No contribution data and no navigation banner links are shown. Note: the URL stays at /contributions (the form renders in place); do not assert a redirect to /login
  2. Go to / and then to /admin while still signed out.
    - expect: Each visit shows the 'Sign in' heading and no application data
  3. Sign in with signIn(page, 'cfo') and go to /contributions.
    - expect: The 'Sign in' heading is hidden and the contributions table is shown

#### 1.3. Row 2: Related records are linked across contribution, contributor, and payment

**File:** `tests/eo/general/row-02-linked-records.spec.ts`

**Steps:**
  1. Shared data: reads Group 4 fixture contributor 'Split Sam' (split.sam@g4.fixture.test, contributor id T33) in period 9503. Mutates: nothing (read-only; no edit, correct, or issue buttons are clicked). Call signIn(page, 'cfo') and go to /contributions?periodId=9503&entityKind=PARTY.
    - expect: The contributions table lists a row with Donor 'Split Sam', amount $300.00, Period 9503, Entity PARTY, Receipt ISSUED
  2. Click the 'Split Sam' donor link in that row.
    - expect: URL matches /contributions/<id>, heading 'Contribution' is visible
    - expect: The 'Payment' panel shows no 'Qomon' badge (manual entry), Amount $500.00, Method 'Cheque', Note 'fixture-g4-3', and a 'Donor who paid' link 'Split Sam'
    - expect: The panel text 'Split across 2 contributions:' is shown with a table: 'this contribution' $300.00 'Party (province-wide)', and a linked row $200.00 'Constituency association, riding 121' marked 'agency'. The two amounts sum to the payment's $500.00
    - expect: The 'Contribution' panel shows Donor link 'Split Sam' with 'Individual, contributor id T33', Amount $300.00, Recipient 'Party (province-wide)'
    - expect: The 'Allocations & receipts' table lists a receipt number starting 'GPO-' with status ISSUED and $300.00
  3. Click the 'Split Sam' link under 'Donor' in the Contribution panel.
    - expect: URL matches /contributors/<id>, heading 'Split Sam' is visible, details show 'Email: split.sam@g4.fixture.test' and 'Contributor id: T33'
    - expect: The 'Contributions' table on the contributor page lists both related contributions: $300.00 PARTY 9503 ACTIVE and $200.00 'CA (riding 121)' 9503 ACTIVE
  4. Click the date link ('3/1/2029') of the $300.00 row in the contributor's Contributions table.
    - expect: The app returns to the same contribution detail page (heading 'Contribution', amount $300.00), showing the link is two-way

#### 1.4. Row 2: Relational integrity is covered by the API tests

**File:** `tests/eo/general/row-02-relational-integrity.spec.ts`

**Steps:**
  1. This is not a browser test. Relational integrity (foreign keys, no hard deletes, split payments summing to the payment) is covered by apps/tax-receipts/api/src/invariants/db-invariants.test.ts and apps/tax-receipts/api/src/invariants/payment-contribution.test.ts. The generator should write this scenario as a test.skip with that note, containing no browser steps. The schema itself is shown on the call from apps/tax-receipts/api/prisma/schema.prisma on PostgreSQL.
    - expect: The spec file contains a single test.skip titled 'Row 2: Relational integrity is covered by the API tests' whose note names the two API test files above
