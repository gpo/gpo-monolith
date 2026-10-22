// spec: specs/eo-validation.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Validation and Controls', () => {
  test('Row 36: Live: a repeat same-amount gift a day later raises A6', async ({ page }) => {
    const sfx = Date.now().toString(36);
    const lastName = `Gift${sfx}`;
    const donorName = `Dblprobe ${lastName}`;
    const reason = `e2e a6 ${sfx}`;

    // 1. Sign in as admin.
    await signIn(page, 'admin');

    // 2. At /payments/new add the contributor, enter Amount 50, Received on 2025-03-15, save, and open the contribution.
    await page.goto('/payments/new');
    await page.getByRole('button', { name: 'Not on file? Add a new contributor' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'First name' }).fill('Dblprobe');
    await dialog.getByRole('textbox', { name: 'Last name' }).fill(lastName);
    await dialog.getByRole('textbox', { name: 'Street number' }).fill('12');
    await dialog.getByRole('textbox', { name: 'Street', exact: true }).fill('Queen St');
    await dialog.getByRole('textbox', { name: 'City' }).fill('Toronto');
    await dialog.getByRole('textbox', { name: 'Postal code' }).fill('M5V 2T6');
    await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill(reason);
    await dialog.getByRole('button', { name: 'Add contributor' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Donor who paid' })).toHaveValue(donorName);

    await page.getByRole('textbox', { name: 'Amount ($)' }).first().fill('50');
    await page.getByRole('textbox', { name: 'Received on' }).fill('2025-03-15');
    await page.getByRole('textbox', { name: 'Reason (required)' }).fill(reason);
    await page.getByRole('button', { name: 'Save payment' }).click();
    await page.getByRole('link', { name: 'Open the contribution' }).click();
    await expect(page.getByText('None.')).toBeVisible();

    // 3. Go to /payments/new again, pick the same donor, Amount 50, Received on 2025-03-16, save, and open the contribution.
    await page.goto('/payments/new');
    await page.getByRole('textbox', { name: 'Donor who paid' }).fill('Dblprobe');
    await page.getByRole('option', { name: new RegExp(donorName) }).click();
    await page.getByRole('textbox', { name: 'Amount ($)' }).first().fill('50');
    await page.getByRole('textbox', { name: 'Received on' }).fill('2025-03-16');
    await page.getByRole('textbox', { name: 'Reason (required)' }).fill(reason);
    await page.getByRole('button', { name: 'Save payment' }).click();
    await page.getByRole('link', { name: 'Open the contribution' }).click();
    await expect(page.getByText('2025 General Election', { exact: true })).toBeVisible();
    const workItem = page.getByRole('row', { name: /Possible duplicate contribution \(A6\)/ });
    await expect(workItem).toBeVisible();
    await expect(workItem).toContainText('OPEN');

    // 4. Go to /work-queue and find the row for the donor.
    await page.goto('/work-queue');
    const queueRow = page
      .getByRole('row')
      .filter({ hasText: donorName })
      .filter({ hasText: '(A6)' });
    await expect(queueRow).toHaveCount(1);
    await expect(queueRow).toContainText('OPEN');
  });
});
