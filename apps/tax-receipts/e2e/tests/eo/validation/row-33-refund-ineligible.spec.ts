// spec: specs/eo-validation.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Validation and Controls', () => {
  test('Row 33: Resolve an ineligible contributor by REFUND from the correction panel', async ({ page }) => {
    const sfx = Date.now().toString(36);
    const lastName = `Refund${sfx}`;
    const donor = `Ineligible ${lastName}`;

    // 1. Sign in as admin.
    await signIn(page, 'admin');

    // 2. Go to /payments/new, add a new contributor with a BC address.
    await page.goto('/payments/new');
    await page.getByRole('button', { name: 'Not on file? Add a new contributor' }).click();
    const addDialog = page.getByRole('dialog');
    await addDialog.getByRole('textbox', { name: 'First name' }).fill('Ineligible');
    await addDialog.getByRole('textbox', { name: 'Last name' }).fill(lastName);
    await addDialog.getByRole('textbox', { name: 'Street number' }).fill('456');
    await addDialog.getByRole('textbox', { name: 'Street', exact: true }).fill('Robson St');
    await addDialog.getByRole('textbox', { name: 'City' }).fill('Vancouver');
    await addDialog.getByLabel('Province').selectOption('BC');
    await addDialog.getByRole('textbox', { name: 'Postal code' }).fill('V6B 1A1');
    await addDialog.getByRole('textbox', { name: 'Reason (required)' }).fill(`e2e b1 ${sfx}`);
    const addButton = addDialog.getByRole('button', { name: 'Add contributor' });
    await expect(addButton).toBeEnabled();
    await addButton.click();
    await expect(addDialog).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Donor who paid' })).toHaveValue(donor);

    // 3. Fill Amount, Received on, and Reason; save the payment and open the contribution.
    await page.getByRole('textbox', { name: 'Amount ($)' }).first().fill('50');
    await page.getByRole('textbox', { name: 'Received on' }).fill('2025-03-15');
    await page.getByRole('textbox', { name: 'Reason (required)' }).fill(`e2e b1 ${sfx}`);
    const savePayment = page.getByRole('button', { name: 'Save payment' });
    await expect(savePayment).toBeEnabled();
    await savePayment.click();
    await page.getByRole('link', { name: 'Open the contribution' }).click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    await expect(page.getByText('2025 General Election', { exact: true })).toBeVisible();
    await expect(page.getByText('456 Robson St, Vancouver BC V6B 1A1, CA')).toBeVisible();
    const b1Item = page.getByRole('row').filter({ hasText: "Donor's address is out of province (B1)" });
    const c3Item = page.getByRole('row').filter({ hasText: 'Postal code is malformed or outside Ontario (C3)' });
    await expect(b1Item).toContainText('OPEN');
    await expect(c3Item).toContainText('OPEN');

    // 4. Record the contribution id, click Correct, and choose Action Refund.
    const contributionId = new URL(page.url()).pathname.split('/').pop()!;
    await page.getByRole('button', { name: 'Correct', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Action').selectOption('Refund');
    await expect(
      dialog.getByText('Marks this payment ($50.00) and its contributions refunded, and cancels any receipt for them'),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Commit correction' })).toBeDisabled();

    // 5. Fill Reason and preview the cascade.
    await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill(`e2e out of province refund ${sfx}`);
    await dialog.getByRole('button', { name: 'Preview cascade' }).click();
    const previewRow = dialog.getByRole('row').filter({ hasText: `${donor}, $50.00, Party (province-wide)` });
    await expect(previewRow).toContainText('refunded');
    await expect(dialog.getByText('Payment: $50.00 → $50.00, RECEIVED → REFUNDED')).toBeVisible();
    await expect(dialog.getByText('None affected: nothing had been receipted.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Commit correction' })).toBeEnabled();

    // 6. Commit the correction.
    await dialog.getByRole('button', { name: 'Commit correction' }).click();
    await expect(dialog.getByText('Correction committed')).toBeVisible();
    await expect(dialog.getByText('0 contributions created, 0 receipts cancelled, no receipts issued.')).toBeVisible();

    // 7. Close the dialog and read the contribution page.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText('This contribution is REFUNDED; it is history, not the working record.'),
    ).toBeVisible();
    await expect(b1Item).toContainText('RESOLVED');
    await expect(c3Item).toContainText('RESOLVED');

    // 8. Go to /work-queue and find the rows for the contributor.
    await page.goto('/work-queue');
    const note = `closed by a correction: ${contributionId} is now REFUNDED`;
    for (const code of ['(B1)', '(C3)']) {
      const row = page.getByRole('row').filter({ hasText: donor }).filter({ hasText: code });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('RESOLVED');
      await expect(row).toContainText(note);
    }
  });
});
