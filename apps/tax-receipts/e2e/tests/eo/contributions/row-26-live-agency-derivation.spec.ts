// spec: specs/eo-contributions.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Contributions', () => {
  test('Row 26: Live: agency is derived from received-by and recipient', async ({ page }) => {
    const sfx = Date.now().toString(36);
    const agencyHelp = page.getByText('Agency contribution: GPO received it for another entity');

    // 1. Sign in as admin.
    await signIn(page, 'admin');

    // 2. Go to /payments/new, add a new contributor, fill Amount 200 and Received on 2025-03-15.
    await page.goto('/payments/new');
    await page.getByRole('button', { name: 'Not on file? Add a new contributor' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'First name' }).fill('Agency');
    await dialog.getByRole('textbox', { name: 'Last name' }).fill(`Live${sfx}`);
    await dialog.getByRole('textbox', { name: 'Street number' }).fill('12');
    await dialog.getByRole('textbox', { name: 'Street', exact: true }).fill('Queen St');
    await dialog.getByRole('textbox', { name: 'City' }).fill('Toronto');
    await dialog.getByRole('textbox', { name: 'Postal code' }).fill('M5V 2T6');
    await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill(`e2e agency ${sfx}`);
    await expect(dialog.getByRole('button', { name: 'Add contributor' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Add contributor' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Donor who paid' })).toHaveValue(`Agency Live${sfx}`);
    await page.getByRole('textbox', { name: 'Amount ($)' }).first().fill('200');
    await page.getByRole('textbox', { name: 'Received on' }).fill('2025-03-15');

    // 3. Choose Recipient 'Constituency association'; Riding 121 · York—Simcoe.
    await page.getByLabel('Recipient').selectOption('Constituency association');
    await page.getByRole('textbox', { name: 'Riding' }).fill('121');
    await page.getByRole('option', { name: '121 · York—Simcoe' }).click();
    await expect(page.getByRole('textbox', { name: 'Riding' })).toHaveValue(/121/);
    await expect(agencyHelp).toBeVisible();

    // 4. Change Received by to 'Entity / subspace entry'.
    await page.getByLabel('Received by').selectOption('Entity / subspace entry');
    await expect(agencyHelp).toBeHidden();

    // 5. Change Received by back to GPO, fill Reason, save, and open the contribution.
    await page.getByLabel('Received by').selectOption('GPO (party office, central)');
    await expect(agencyHelp).toBeVisible();
    await page.getByRole('textbox', { name: 'Reason (required)' }).fill(`e2e agency ${sfx}`);
    const save = page.getByRole('button', { name: 'Save payment' });
    await expect(save).toBeEnabled();
    await save.click();
    await page.getByRole('link', { name: 'Open the contribution' }).click();

    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    const recipient = page
      .locator('div')
      .filter({ hasText: /^Constituency association, riding 121agency$/ });
    await expect(recipient.getByText('agency', { exact: true })).toBeVisible();
    await expect(page.getByText('Constituency association, riding 121')).toBeVisible();
    await expect(page.getByText('2025 General Election')).toBeVisible();
    await expect(page.getByText('Work items')).toBeVisible();
    await expect(page.getByText('None.', { exact: true })).toBeVisible();
  });
});
