// spec: specs/eo-contributors.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Contributors', () => {
  test('Row 21: Add a new contributor from the New payment form records the name', async ({ page }) => {
    const sfx = Date.now().toString(36);
    const fullName = `Grace Hopper-${sfx}`;

    // 1. Sign in as admin and go to /payments/new (heading 'Add a payment').
    await signIn(page, 'admin');
    await page.goto('/payments/new');
    await expect(page.getByRole('heading', { name: 'Add a payment' })).toBeVisible();
    const addNew = page.getByRole('button', { name: 'Not on file? Add a new contributor' });
    await expect(addNew).toBeVisible();

    // 2. Click 'Not on file? Add a new contributor' and fill the dialog.
    await addNew.click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'First name' }).fill('Grace');
    await dialog.getByRole('textbox', { name: 'Last name' }).fill(`Hopper-${sfx}`);
    await dialog.getByRole('textbox', { name: 'Street number' }).fill('77');
    await dialog.getByRole('textbox', { name: 'Street', exact: true }).fill('Queen St W');
    await dialog.getByRole('textbox', { name: 'City' }).fill('Ottawa');
    await dialog.getByRole('textbox', { name: 'Postal code' }).fill('K1A 0B1');
    await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill(`Donor walked in with a cheque ${sfx}`);
    const addButton = dialog.getByRole('button', { name: 'Add contributor' });
    await expect(addButton).toBeEnabled();
    await addButton.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(`Donor (blank = ${fullName})`)).toBeVisible();

    // 3. Fill the payment: amount 50, Received on 2025-03-15, Period '2025 General Election', reason; save.
    await page.getByRole('textbox', { name: 'Amount ($)' }).first().fill('50');
    await page.getByRole('textbox', { name: 'Received on' }).fill('2025-03-15');
    await page.getByLabel('Period').selectOption({ label: '2025 General Election' });
    await page.getByRole('textbox', { name: 'Reason (required)' }).fill(`Cheque received at office ${sfx}`);
    const save = page.getByRole('button', { name: 'Save payment' });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByRole('heading', { name: 'Payment recorded' })).toBeVisible();
    await expect(page.getByText('The payment and its contribution were recorded.')).toBeVisible();
    const openLink = page.getByRole('link', { name: 'Open the contribution' });
    await expect(openLink).toBeVisible();

    // 4. Click 'Open the contribution' and read the Donor fields.
    await openLink.click();
    await expect(page.getByText('Donor who paid')).toBeVisible();
    await expect(page.getByRole('link', { name: fullName })).toHaveCount(2);

    // 5. Go to /contributors, search the suffix, open the contributor.
    await page.goto('/contributors');
    await page.getByRole('textbox', { name: 'Search' }).fill(sfx);
    await page.getByRole('link', { name: fullName }).click();
    await expect(page.getByRole('heading', { name: fullName })).toBeVisible();
    await expect(page.getByText('First name: Grace')).toBeVisible();
    await expect(page.getByText(`Last name: Hopper-${sfx}`)).toBeVisible();
    const rows = page.getByRole('row').filter({ hasText: 'PARTY' });
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('$50.00');
    await expect(rows.first()).toContainText('ACTIVE');
  });
});
