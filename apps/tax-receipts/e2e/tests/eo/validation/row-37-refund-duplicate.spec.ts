// spec: specs/eo-validation.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Validation and Controls', () => {
  test('Row 37: Resolve a duplicate contribution by REFUNDing the duplicate', async ({ page }) => {
    const sfx = Date.now().toString(36);
    const lastName = `Refund${sfx}`;
    const donorName = `Dblprobe ${lastName}`;

    // 1. Sign in as admin.
    await signIn(page, 'admin');

    // 2. Create the contributor and both payments (2025-03-15 and 2025-03-16, $50 each); end on the second contribution.
    await page.goto('/payments/new');
    await page.getByRole('button', { name: 'Not on file? Add a new contributor' }).click();
    const addDialog = page.getByRole('dialog');
    await addDialog.getByRole('textbox', { name: 'First name' }).fill('Dblprobe');
    await addDialog.getByRole('textbox', { name: 'Last name' }).fill(lastName);
    await addDialog.getByRole('textbox', { name: 'Street number' }).fill('12');
    await addDialog.getByRole('textbox', { name: 'Street', exact: true }).fill('Queen St');
    await addDialog.getByRole('textbox', { name: 'City' }).fill('Toronto');
    await addDialog.getByRole('textbox', { name: 'Postal code' }).fill('M5V 2T6');
    await addDialog.getByRole('textbox', { name: 'Reason (required)' }).fill(`e2e a6 refund ${sfx}`);
    const addButton = addDialog.getByRole('button', { name: 'Add contributor' });
    await expect(addButton).toBeEnabled();
    await addButton.click();
    await expect(addDialog).toBeHidden();

    await page.getByRole('textbox', { name: 'Amount ($)' }).first().fill('50');
    await page.getByRole('textbox', { name: 'Received on' }).fill('2025-03-15');
    await page.getByRole('textbox', { name: 'Reason (required)' }).fill(`e2e a6 refund ${sfx}`);
    const savePayment = page.getByRole('button', { name: 'Save payment' });
    await expect(savePayment).toBeEnabled();
    await savePayment.click();
    await page.getByRole('link', { name: 'Open the contribution' }).click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    const originalUrl = page.url();

    await page.goto('/payments/new');
    await page.getByRole('textbox', { name: 'Donor who paid' }).fill(donorName);
    await page.getByRole('option', { name: new RegExp(donorName) }).click();
    await page.getByRole('textbox', { name: 'Amount ($)' }).first().fill('50');
    await page.getByRole('textbox', { name: 'Received on' }).fill('2025-03-16');
    await page.getByRole('textbox', { name: 'Reason (required)' }).fill(`e2e a6 refund ${sfx}`);
    await expect(savePayment).toBeEnabled();
    await savePayment.click();
    await page.getByRole('link', { name: 'Open the contribution' }).click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    await expect(page).not.toHaveURL(originalUrl);
    const duplicateId = new URL(page.url()).pathname.split('/').pop()!;
    await expect(page.getByRole('cell', { name: /Possible duplicate contribution.*A6/ })).toBeVisible();

    // 3. Click 'Correct', choose Action 'Refund', fill Reason, click 'Preview cascade'.
    await page.getByRole('button', { name: 'Correct', exact: true }).click();
    const correctDialog = page.getByRole('dialog');
    await correctDialog.getByLabel('Action').selectOption('Refund');
    await correctDialog.getByLabel('Reason (required)').fill('e2e duplicate gift refunded');
    await correctDialog.getByRole('button', { name: 'Preview cascade' }).click();
    await expect(correctDialog.getByRole('cell', { name: /\$50\.00, Party \(province-wide\)/ })).toBeVisible();
    await expect(correctDialog.getByRole('cell', { name: 'refunded' })).toBeVisible();
    await expect(correctDialog.getByText('Payment: $50.00 → $50.00, RECEIVED → REFUNDED')).toBeVisible();
    const commit = correctDialog.getByRole('button', { name: 'Commit correction' });
    await expect(commit).toBeEnabled();

    // 4. Click 'Commit correction'.
    await commit.click();
    await expect(correctDialog.getByText('Correction committed')).toBeVisible();

    // 5. Close the dialog and go to /work-queue; find the row for the donor.
    await page.keyboard.press('Escape');
    await page.goto('/work-queue');
    const a6Row = page.getByRole('row').filter({ hasText: donorName }).filter({ hasText: '(A6)' });
    await expect(a6Row).toHaveCount(1);
    await expect(a6Row).toContainText('RESOLVED');
    await expect(a6Row).toContainText(`closed by a correction: ${duplicateId} is now REFUNDED`);

    // 6. Open the first (original) contribution from /contributions by searching the donor name.
    await page.goto('/contributions');
    await page.getByRole('textbox', { name: 'Donor (name or email)' }).fill(lastName);
    const originalRow = page.getByRole('row').filter({ hasText: donorName });
    await expect(originalRow).toHaveCount(1);
    await expect(originalRow).toContainText('$50.00');
    await expect(originalRow).toContainText('3/15/2025');
    await originalRow.getByRole('link').first().click();
    await expect(page).toHaveURL(originalUrl);
    // The plan expected an ACTIVE status; the page prints none for active rows, so assert the
    // absence of the REFUNDED banner (only the duplicate was refunded).
    await expect(page.getByText('This contribution is REFUNDED')).toHaveCount(0);
    await expect(page.getByText('3/15/2025').first()).toBeVisible();
  });
});
