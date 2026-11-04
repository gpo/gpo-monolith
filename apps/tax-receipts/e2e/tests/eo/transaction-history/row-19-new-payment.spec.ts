// spec: specs/eo-transaction-history.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { changeField, openChangeEntry, signIn, switchUser } from '../../helpers.js';

test.describe('Transaction History', () => {
  test('Row 19: Audit on new records - a live payment creates a Contribution entry with before null', async ({
    page,
  }) => {
    const sfx = Date.now().toString(36);
    const lastName = `Pay${sfx}`;
    const paymentReason = `Row19 payment ${sfx}`;

    // 1. Sign in as admin and add the contributor 'Pablo Pay<suffix>'
    await signIn(page, 'admin');
    await page.goto('/contributors');
    await page.getByRole('button', { name: 'Add a contributor' }).click();
    const addDialog = page.getByRole('dialog');
    await addDialog.getByLabel('First name').fill('Pablo');
    await addDialog.getByLabel('Last name').fill(lastName);
    await addDialog.getByLabel('Street number').fill('10');
    await addDialog.getByLabel('Street', { exact: true }).fill('Elm St');
    await addDialog.getByLabel('City').fill('Toronto');
    await addDialog.getByLabel('Postal code').fill('M5V 2T6');
    await addDialog.getByLabel('Reason (required)').fill(`Row19p create ${sfx}`);
    await expect(addDialog.getByRole('button', { name: 'Add contributor' })).toBeEnabled();
    await addDialog.getByRole('button', { name: 'Add contributor' }).click();
    await expect(page).toHaveURL(/\/contributors\/[^/]+$/);

    // Go to Contributions then click 'Add payment', pick the donor, amount 40, period, reason
    await page.getByRole('banner').getByRole('link', { name: 'Contributions' }).click();
    await page.getByRole('link', { name: 'Add payment' }).click();
    await expect(page.getByRole('heading', { name: 'Add a payment' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Donor who paid' }).fill(lastName);
    await page.getByRole('option', { name: new RegExp(lastName) }).click();
    await page.getByRole('textbox', { name: 'Amount ($)' }).first().fill('40');
    // Chosen explicitly (overrides the plan's date) so no A1 work item opens.
    await page.getByRole('textbox', { name: 'Received on' }).fill('2025-03-15');
    await page.getByLabel('Period').selectOption('2025 General Election');
    await page.getByRole('textbox', { name: 'Reason (required)' }).fill(paymentReason);
    const savePayment = page.getByRole('button', { name: 'Save payment' });
    await expect(savePayment).toBeEnabled();
    await savePayment.click();
    await expect(page.getByText('Payment recorded')).toBeVisible();

    // 2. Click 'Open the contribution' and click 'Show 2 changes'; capture the contribution id
    await page.getByRole('link', { name: 'Open the contribution' }).click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    const contributionId = new URL(page.url()).pathname.split('/').pop()!;
    await page.getByRole('button', { name: 'Show 2 changes' }).click();
    // Each entry is a row (the contribution's own and its payment's); By and the old and new
    // values are checked in step 3.
    await expect(page.getByText(paymentReason)).toHaveCount(2);

    // 3. Sign in as sysadmin (admin@ cannot see the Change log), go to /admin/change-log,
    //    choose Subject type 'Contribution', type the contribution id
    await switchUser(page, 'sysadmin');
    await page.goto('/admin/change-log');
    await page.getByLabel('Subject type').selectOption('Contribution');
    await page.getByLabel('Subject id').fill(contributionId);
    const rows = page.getByRole('row').filter({ hasText: contributionId });
    await expect(rows).toHaveCount(1);
    const row = rows.first();
    await expect(row.getByRole('cell', { name: `Contribution (${contributionId})` })).toBeVisible();
    await expect(row.getByRole('cell', { name: 'Receipt Administrator' })).toBeVisible();
    await expect(row.getByRole('cell', { name: paymentReason })).toBeVisible();
    // A creation has no before, so the Changes cell reads "Created" and the dialog shows
    // the new record's fields as added, with an empty Before.
    await expect(row.getByRole('cell').last()).toHaveText('Created');
    const entryDialog = await openChangeEntry(page, row);
    await expect(entryDialog.getByRole('heading', { name: new RegExp(`^Created Contribution \\(${contributionId}\\)`) })).toBeVisible();
    await expect(changeField(entryDialog, 'amountCents').getByRole('cell').nth(2)).toHaveText('—');
    await expect(changeField(entryDialog, 'amountCents').getByRole('cell').nth(3)).toHaveText('4000');

    const response = await page.request.get(`/api/change-log?subjectId=${contributionId}`);
    expect(response.ok()).toBeTruthy();
    const { data } = await response.json();
    expect(data).toHaveLength(1);
    expect(data[0].before).toBeNull();
    expect(data[0].reason).toBe(paymentReason);
  });
});
