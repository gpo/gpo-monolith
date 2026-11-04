// spec: specs/eo-validation.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Validation and Controls', () => {
  test('Row 39: Resolve an over-limit contribution by refunding it', async ({ page }) => {
    const sfx = Date.now().toString(36);
    const lastName = `Refund${sfx}`;
    const donor = `Limit ${lastName}`;

    // 1. Sign in as admin.
    await signIn(page, 'admin');

    // 2. Create the contributor and payment (Received on 2026-06-01, Period 2025 General Election). Open the contribution.
    await page.goto('/payments/new');
    await page.getByRole('button', { name: 'Not on file? Add a new contributor' }).click();
    const addDialog = page.getByRole('dialog');
    await addDialog.getByRole('textbox', { name: 'First name' }).fill('Limit');
    await addDialog.getByRole('textbox', { name: 'Last name' }).fill(lastName);
    await addDialog.getByRole('textbox', { name: 'Street number' }).fill('13');
    await addDialog.getByRole('textbox', { name: 'Street', exact: true }).fill('Queen St');
    await addDialog.getByRole('textbox', { name: 'City' }).fill('Toronto');
    await addDialog.getByRole('textbox', { name: 'Postal code' }).fill('M5V 2T6');
    await addDialog.getByRole('textbox', { name: 'Reason (required)' }).fill(`e2e b2 ${sfx}`);
    await addDialog.getByRole('button', { name: 'Add contributor' }).click();
    await expect(addDialog).toBeHidden();

    await page.getByRole('textbox', { name: 'Amount ($)' }).first().fill('6000');
    await page.getByRole('textbox', { name: 'Received on' }).fill('2026-06-01');
    await page.getByRole('combobox', { name: 'Period' }).selectOption('2025 General Election');
    await page.getByRole('textbox', { name: 'Reason (required)' }).fill(`e2e b2 ${sfx}`);
    await page.getByRole('button', { name: 'Save payment' }).click();
    await page.getByRole('link', { name: 'Open the contribution' }).click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    const contributionId = new URL(page.url()).pathname.split('/').pop()!;
    await expect(page.getByRole('cell', { name: 'Donor is over a contribution limit' })).toBeVisible();
    await expect(page.getByRole('row', { name: /Donor is over a contribution limit/ })).toContainText('OPEN');

    // 3. Click 'Correct', choose 'Refund', Reason, 'Preview cascade', then 'Commit correction'.
    await page.getByRole('button', { name: 'Correct', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Action').selectOption('Refund');
    await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill('e2e over-limit refund');
    await dialog.getByRole('button', { name: 'Preview cascade' }).click();
    const commit = dialog.getByRole('button', { name: 'Commit correction' });
    await expect(commit).toBeEnabled();
    await commit.click();
    await expect(dialog.getByText('Correction committed')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByText('This contribution is REFUNDED; it is history, not the working record.'),
    ).toBeVisible();

    // 4. Go to /work-queue and find the rows for the donor.
    await page.goto('/work-queue');
    const b2Row = page
      .getByRole('row')
      .filter({ hasText: donor })
      .filter({ hasText: '(B2)' });
    await expect(b2Row).toHaveCount(1);
    await expect(b2Row).toContainText('RESOLVED');
    await expect(b2Row).toContainText(`closed by a correction: ${contributionId} is now REFUNDED`);
  });
});
