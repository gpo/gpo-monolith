// spec: specs/eo-issue-tax-receipt.md
// seed: tests/seed.spec.ts

import { expect, test, type Page } from '@playwright/test';
import { pdfTextFromBuffer, signIn } from '../../helpers.js';

// ---- Recipe R helpers (the same code lives in recipe.ts) ----

function newSuffix(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

/** R1, as sysadmin. Returns the period id. */
async function createPeriod(
  page: Page,
  sfx: string,
  opts: { kind?: 'ANNUAL' | 'GENERAL_ELECTION' } = {},
): Promise<number> {
  const id = 900000 + Math.floor(Math.random() * 100000);
  await page.goto('/admin/periods');
  await page.getByRole('textbox', { name: 'Id (EO period id)' }).fill(String(id));
  await page.getByRole('textbox', { name: 'Name' }).fill(`E2E ${sfx}`);
  await page.getByLabel('Kind').selectOption(opts.kind ?? 'ANNUAL');
  await page.getByRole('textbox', { name: 'Starts at (UTC)' }).fill('2024-01-01T00:00');
  await page.getByRole('textbox', { name: 'Ends at (UTC)' }).fill('2024-02-01T00:00');
  await page.getByRole('textbox', { name: 'Reason (required, recorded in' }).fill(`E2E period ${sfx}`);
  const save = page.getByRole('button', { name: 'Save period' });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(
    page.getByText('Saved. Validation re-run against every mirrored contribution.'),
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: String(id), exact: true })).toBeVisible();
  return id;
}

/** R2, as admin. Returns the contributor id (from the URL) and display name. */
async function addContributor(
  page: Page,
  sfx: string,
  opts: { firstName?: string; lastName?: string } = {},
): Promise<{ id: string; name: string }> {
  const firstName = opts.firstName ?? 'Iris';
  const lastName = opts.lastName ?? `Issuer${sfx}`;
  await page.goto('/contributors');
  await page.getByRole('button', { name: 'Add a contributor' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('First name').fill(firstName);
  await dialog.getByLabel('Last name').fill(lastName);
  await dialog.getByLabel('Email').fill(`iris.${sfx}@e2e.test`);
  await dialog.getByLabel('Street number').fill('77');
  await dialog.getByLabel('Street', { exact: true }).fill('Maple Ave');
  await dialog.getByLabel('City').fill('Ottawa');
  await dialog.getByLabel('Province').selectOption('ON');
  await dialog.getByLabel('Postal code').fill('K1A 0B1');
  await dialog.getByLabel('Country').fill('CA');
  await dialog.getByLabel('Reason (required)').fill(`E2E contributor ${sfx}`);
  const add = dialog.getByRole('button', { name: 'Add contributor' });
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page).toHaveURL(/\/contributors\/[^/]+$/);
  await expect(page.getByText('Address: 77 Maple Ave, Ottawa ON K1A 0B1, CA')).toBeVisible();
  const id = new URL(page.url()).pathname.split('/').pop()!;
  return { id, name: `${firstName} ${lastName}` };
}

/** R3, as admin: records one payment with one contribution. `donorName` is the
 *  full "First Last" name; `periodName` is the period's name (for example `E2E <sfx>`). */
async function addPayment(
  page: Page,
  opts: {
    donorName: string;
    periodName: string;
    amount: number | string;
    receivedOn: string;
    acceptedOn?: string;
    recipient?: 'Party (province-wide)' | 'Constituency association' | 'Campaign' | 'Leadership contestant';
    riding?: string; // for example '121' (chooses the option matching /121.*York-Simcoe/ when 121)
    goodsOrServices?: boolean;
    nonDeductible?: number | string;
    reason?: string;
  },
): Promise<void> {
  await page.goto('/payments/new');
  const surname = opts.donorName.split(' ').pop()!;
  await page.getByRole('textbox', { name: 'Donor who paid' }).fill(surname);
  await page.getByRole('option', { name: new RegExp(escapeRegExp(opts.donorName)) }).click();
  await page.getByRole('textbox', { name: 'Amount ($)' }).first().fill(String(opts.amount));
  await page.getByRole('textbox', { name: 'Received on' }).fill(opts.receivedOn);
  if (opts.recipient) await page.getByLabel('Recipient').selectOption(opts.recipient);
  if (opts.riding) {
    await page.getByRole('textbox', { name: 'Riding' }).fill(opts.riding);
    await page.getByRole('option', { name: new RegExp(`${escapeRegExp(opts.riding)}.*York-Simcoe`) }).click();
  }
  await page.getByLabel('Period').selectOption(opts.periodName);
  if (opts.acceptedOn) await page.getByRole('textbox', { name: 'Accepted on' }).fill(opts.acceptedOn);
  if (opts.goodsOrServices) {
    await page.getByRole('checkbox', { name: 'Donor received goods or services' }).check();
    await page.getByRole('textbox', { name: 'Non-deductible ($)' }).fill(String(opts.nonDeductible ?? 0));
  }
  await page.getByRole('textbox', { name: 'Reason (required)' }).fill(opts.reason ?? 'E2E payment');
  const save = page.getByRole('button', { name: 'Save payment' });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole('heading', { name: 'Payment recorded' })).toBeVisible();
}

/** R4, as cfo: review, generate, and return the issued receipt numbers. */
async function issueSpace(
  page: Page,
  periodId: number,
  opts: {
    entity?: 'PARTY' | 'CAMPAIGN';
    ridingNumber?: number;
    label?: string;
    delivery?: string;
    oneReceiptPerDonor?: boolean;
    reason?: string;
  } = {},
): Promise<{ receiptNumbers: string[] }> {
  const entity = opts.entity ?? 'PARTY';
  const query = entity === 'CAMPAIGN' ? `?ridingNumber=${opts.ridingNumber ?? 121}` : '';
  await page.goto(`/spaces/${periodId}/${entity}/issue${query}`);
  await expect(page.getByText('Total amount', { exact: true })).toBeVisible();
  if (opts.oneReceiptPerDonor) {
    await page.getByText('One receipt per donor', { exact: true }).click();
    await expect(page.getByRole('switch', { name: /One receipt per donor/ })).toBeChecked();
  }
  await page.getByRole('button', { name: 'Next: generate' }).click();
  if (opts.label !== undefined) {
    await page
      .getByRole('textbox', { name: 'Received-by label (as it should print on every receipt)' })
      .fill(opts.label);
  }
  if (opts.delivery) await page.getByLabel('Delivery override').selectOption({ label: opts.delivery });
  await page
    .getByRole('textbox', { name: 'Reason for this issuance run (required)' })
    .fill(opts.reason ?? 'E2E issue');
  const generate = page.getByRole('button', { name: 'Generate receipts' });
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect(page.getByText(/\d+ issued, 0 failed\./)).toBeVisible();
  const receiptNumbers = await page.getByText(/^GPO-00\d{6}$/).allTextContents();
  return { receiptNumbers };
}

// ---- The scenario ----

test.describe('Issue Tax Receipt: issuance and receipt contents', () => {
  test('Row 41: Generate receipts from contribution records in the space wizard and download the PDF', async ({
    page,
  }) => {
    const sfx = newSuffix();

    // 1. Read-only look at Space A. Sign in as cfo, open /spaces/9502/PARTY/issue. Do NOT choose Generate.
    await signIn(page, 'cfo');
    await page.goto('/spaces/9502/PARTY/issue');
    await expect(page.getByRole('heading', { name: 'Issue receipts' })).toBeVisible();
    await expect(page.getByText(/Period 9502\s\S\sParty \(province-wide\)/)).toBeVisible();
    const ritaRow = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Ready Rita' }) });
    await expect(ritaRow).toContainText('$50.00');
    await expect(page.getByRole('link', { name: 'Partial Credit Priya' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Already Issued Ivy' })).toHaveCount(0);
    await signOut(page);

    // 2. Create own data with Recipe R1 to R3: a period, one contributor, and TWO payments
    //    ($50 on 2024-01-10 and $30 on 2024-01-20). Then sign in as cfo and open the own space.
    await signIn(page, 'sysadmin');
    const periodId = await createPeriod(page, sfx);
    await signOut(page);

    await signIn(page, 'admin');
    const donor = await addContributor(page, sfx);
    const periodName = `E2E ${sfx}`;
    await addPayment(page, { donorName: donor.name, periodName, amount: 50, receivedOn: '2024-01-10' });
    await addPayment(page, { donorName: donor.name, periodName, amount: 30, receivedOn: '2024-01-20' });
    await signOut(page);

    await signIn(page, 'cfo');
    await page.goto(`/spaces/${periodId}/PARTY/issue`);
    await expect(page.getByText('Total amount', { exact: true })).toBeVisible();
    await expect(page.getByText(/open work item\(s\) block issuance/)).toHaveCount(0);
    await expect(page.getByText('Receipts', { exact: true }).locator('..')).toHaveText(/^Receipts\s*2$/);
    await expect(page.getByText('Total amount', { exact: true }).locator('..')).toHaveText(
      /^Total amount\s*\$80\.00$/,
    );
    const donorRows = page.getByRole('row').filter({ has: page.getByRole('link', { name: donor.name }) });
    await expect(donorRows).toHaveCount(2);

    // 3. Choose 'Next: generate', keep the label 'Green Party of Ontario', fill the run reason,
    //    click 'Generate receipts'.
    const { receiptNumbers } = await issueSpace(page, periodId, { reason: `E2E issue ${sfx}` });
    await expect(page.getByText('2 issued, 0 failed.')).toBeVisible();
    expect(receiptNumbers).toHaveLength(2);
    const resultRows = page.getByRole('row').filter({ has: page.getByText(/^GPO-00\d{6}$/) });
    await expect(resultRows).toHaveCount(2);
    for (const row of await resultRows.all()) {
      await expect(row.getByText(/^GPO-00\d{6}$/)).toBeVisible();
      await expect(row).toContainText(/\$(50|30)\.00/);
      await expect(row.getByRole('link', { name: 'View PDF' })).toBeVisible();
    }

    // 4. Take the href of the first 'View PDF' link, fetch it with page.request.get, and extract the text.
    const firstRow = resultRows.first();
    const firstNumber = (await firstRow.getByText(/^GPO-00\d{6}$/).textContent())!;
    const firstAmount = (await firstRow.textContent())!.match(/\$(50|30)\.00/)![0];
    const href = (await firstRow.getByRole('link', { name: 'View PDF' }).getAttribute('href'))!;
    expect(href).toMatch(/^\/api\/receipts\/[^/]+\/pdf$/);
    const response = await page.request.get(href);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/pdf');
    const text = await pdfTextFromBuffer(await response.body());
    expect(text).toContain(firstNumber);
    expect(text).toContain(`Eligible Amount: ${firstAmount}`);
    expect(text).toContain(donor.name.toUpperCase());

    // 5. Open the contribution (link in the result row) at /contributions/<id>.
    await firstRow.getByRole('link', { name: /^c[a-z0-9]{20,}$/ }).click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    const receiptRow = page.getByRole('row').filter({ hasText: firstNumber });
    await expect(receiptRow).toContainText('ISSUED');
    await expect(receiptRow.getByRole('link', { name: 'View PDF' })).toBeVisible();
    // The page has a payment-level Edit and the contribution's own Edit (the last one).
    await expect(page.getByRole('button', { name: 'Edit', exact: true }).last()).toBeDisabled();
  });
});
