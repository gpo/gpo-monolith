import { expect, type Page } from '@playwright/test';

/**
 * Recipe R from specs/eo-issue-tax-receipt.md: each issuing scenario builds
 * its own period, contributor, and payments, then issues from that period's
 * space, so no seeded fixture is ever issued, cancelled, or reissued. Each
 * helper assumes the right user is already signed in (sysadmin for periods,
 * admin for contributors and payments, cfo for issuing).
 */

export function newSuffix(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

/** R1, as sysadmin. Returns the period id. The period is named `E2E <sfx>`. */
export async function createPeriod(
  page: Page,
  sfx: string,
  opts: { kind?: 'ANNUAL' | 'GENERAL_ELECTION' } = {},
): Promise<number> {
  // a wide range: about 20 scenarios each create one, and ids must not collide
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
  await expect(page.getByText('Saved. Validation re-run against every mirrored contribution.')).toBeVisible();
  await expect(page.getByRole('cell', { name: String(id), exact: true })).toBeVisible();
  return id;
}

/** R2, as admin. Returns the contributor id (from the URL) and display name. */
export async function addContributor(
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
  // the record page loads after the save round-trip; allow a slow server
  await expect(page).toHaveURL(/\/contributors\/[^/]+$/, { timeout: 10_000 });
  await expect(page.getByText('Address: 77 Maple Ave, Ottawa ON K1A 0B1, CA')).toBeVisible({ timeout: 10_000 });
  const id = new URL(page.url()).pathname.split('/').pop()!;
  return { id, name: `${firstName} ${lastName}` };
}

/** R3, as admin: records one payment with one contribution. `donorName` is
 *  the full "First Last" name; `periodName` is the period's name (for
 *  example `E2E <sfx>`), chosen explicitly so overlapping windows of other
 *  scenarios' periods cannot capture it. */
export async function addPayment(
  page: Page,
  opts: {
    donorName: string;
    periodName: string;
    amount: number | string;
    receivedOn: string;
    acceptedOn?: string;
    recipient?: 'Party (province-wide)' | 'Constituency association' | 'Campaign' | 'Leadership contestant';
    /** e.g. '121' (chooses the option "121 · York—Simcoe"; the dash is an
     *  em dash, so the pattern matches any character there) */
    riding?: string;
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
    await page.getByRole('option', { name: new RegExp(`${escapeRegExp(opts.riding)}.*York.Simcoe`) }).click();
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
  await expect(page.getByRole('heading', { name: 'Payment recorded' })).toBeVisible({ timeout: 10_000 });
}

/** R4, as cfo: review, generate, and return the issued receipt numbers (one
 *  per receipt, not per contribution). */
export async function issueSpace(
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
    await page.getByRole('textbox', { name: 'Received-by label (as it should print on every receipt)' }).fill(opts.label);
  }
  if (opts.delivery) await page.getByLabel('Delivery override').selectOption({ label: opts.delivery });
  await page.getByRole('textbox', { name: 'Reason for this issuance run (required)' }).fill(opts.reason ?? 'E2E issue');
  const generate = page.getByRole('button', { name: 'Generate receipts' });
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect(page.getByText(/\d+ issued, 0 failed\./)).toBeVisible({ timeout: 15_000 });
  const receiptNumbers = await page.getByText(/^GPO-00\d{6}$/).allTextContents();
  return { receiptNumbers };
}
