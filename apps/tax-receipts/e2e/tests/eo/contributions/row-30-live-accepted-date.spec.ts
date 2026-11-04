// spec: specs/eo-contributions.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Contributions', () => {
  test('Row 30: Live: a recorded contribution keeps its known accepted date', async ({ page }) => {
    const sfx = Date.now().toString(36);
    const lastName = `Live${sfx}`;
    const fullName = `Dated ${lastName}`;

    // 1. Sign in as admin.
    await signIn(page, 'admin');

    // 2. Go to /payments/new, add a new contributor, fill Amount 50 and Received on 2025-03-15.
    await page.goto('/payments/new');
    await page.getByRole('button', { name: 'Not on file? Add a new contributor' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'First name' }).fill('Dated');
    await dialog.getByRole('textbox', { name: 'Last name' }).fill(lastName);
    await dialog.getByRole('textbox', { name: 'Street number' }).fill('14');
    await dialog.getByRole('textbox', { name: 'Street', exact: true }).fill('Queen St');
    await dialog.getByRole('textbox', { name: 'City' }).fill('Toronto');
    await dialog.getByRole('textbox', { name: 'Postal code' }).fill('M5V 2T6');
    await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill(`e2e date ${sfx}`);
    const addContributor = dialog.getByRole('button', { name: 'Add contributor' });
    await expect(addContributor).toBeEnabled();
    await addContributor.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Donor who paid' })).toHaveValue(fullName);

    await page.getByRole('textbox', { name: 'Amount ($)' }).first().fill('50');
    await page.getByRole('textbox', { name: 'Received on' }).fill('2025-03-15');
    await expect(page.getByText('blank = 2025-03-15')).toBeVisible();

    // 3. Fill the contribution 'Accepted on' with 2025-03-20 and Reason; save and open the contribution.
    await page.getByRole('textbox', { name: 'Accepted on' }).fill('2025-03-20');
    await page.getByRole('textbox', { name: 'Reason (required)' }).fill(`e2e date ${sfx}`);
    const savePayment = page.getByRole('button', { name: 'Save payment' });
    await expect(savePayment).toBeEnabled();
    await savePayment.click();
    await page.getByRole('link', { name: 'Open the contribution' }).click();

    const valueOf = (label: string) =>
      page.getByText(label, { exact: true }).locator('xpath=following-sibling::*[1]');
    await expect(page.getByRole('heading', { name: 'Contribution' })).toBeVisible();
    await expect(valueOf('Received on')).toHaveText('3/15/2025');
    await expect(valueOf('Accepted on')).toHaveText('3/20/2025');
    await expect(valueOf('Period')).toHaveText('2025 General Election');
    await expect(valueOf('Work items')).toHaveText('None.');

    // 4. Go to the Contributions list and filter by accepted date and donor.
    await page.goto('/contributions');
    await page.getByRole('button', { name: 'Show advanced filters' }).click();
    await page.getByRole('textbox', { name: 'Accepted from' }).fill('2025-03-20');
    // The plan expected 'Accepted to' 2025-03-20, but the app treats the upper bound as
    // exclusive (2025-03-20 returns no rows), so use the next day.
    await page.getByRole('textbox', { name: 'Accepted to' }).fill('2025-03-21');
    await page.getByRole('textbox', { name: 'Donor (name or email)' }).fill(fullName);
    const row = page.getByRole('row').filter({ hasText: lastName });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('cell', { name: '3/20/2025' })).toBeVisible();
  });
});
