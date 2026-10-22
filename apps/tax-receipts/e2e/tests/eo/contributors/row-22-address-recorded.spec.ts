// spec: specs/eo-contributors.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Contributors', () => {
  test('Row 22: Contributor address is recorded in structured parts, enforced all-or-nothing, and shown on the record and the contribution detail', async ({ page }) => {
    const sfx = Date.now().toString(36);
    const lastName = `Address-${sfx}`;
    const partialMessage = 'Fill in the street, city, province, postal code, and country, or leave the address blank.';

    // 1. Sign in as admin, go to /contributors, click 'Add a contributor'. Fill First name, Last name, Reason.
    await signIn(page, 'admin');
    await page.goto('/contributors');
    await page.getByRole('button', { name: 'Add a contributor' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Add a contributor' })).toBeVisible();
    await dialog.getByRole('textbox', { name: 'First name' }).fill('Edith');
    await dialog.getByRole('textbox', { name: 'Last name' }).fill(lastName);
    await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill(`E2E row 22 ${sfx}`);
    const addButton = dialog.getByRole('button', { name: 'Add contributor' });
    await expect(addButton).toBeEnabled();
    await expect(dialog.getByText('Optional here, but a receipt cannot be issued without one.')).toBeVisible();
    await expect(dialog.getByLabel('Province')).toHaveValue('ON');
    await expect(dialog.getByLabel('Province').getByRole('option')).toHaveText([
      'ON', 'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'PE', 'QC', 'SK', 'YT',
    ]);
    await expect(dialog.getByRole('textbox', { name: 'Country' })).toHaveValue('CA');

    // 2. Negative: fill only Street 'Elm St'.
    await dialog.getByRole('textbox', { name: 'Street', exact: true }).fill('Elm St');
    await expect(dialog.getByText(partialMessage)).toBeVisible();
    await expect(addButton).toBeDisabled();

    // 3. Negative: add City 'Toronto' but leave Postal code blank.
    await dialog.getByRole('textbox', { name: 'City' }).fill('Toronto');
    await expect(dialog.getByText(partialMessage)).toBeVisible();
    await expect(addButton).toBeDisabled();

    // 4. Fill Street number '10' and Postal code 'M5V 2T6'.
    await dialog.getByRole('textbox', { name: 'Street number' }).fill('10');
    await dialog.getByRole('textbox', { name: 'Postal code' }).fill('M5V 2T6');
    await expect(dialog.getByText(partialMessage)).toBeHidden();
    await expect(addButton).toBeEnabled();

    // 5. Click 'Add contributor'.
    await addButton.click();
    await expect(page.getByRole('heading', { name: `Edith ${lastName}` })).toBeVisible();
    await expect(page.getByText('Address: 10 Elm St, Toronto ON M5V 2T6, CA')).toBeVisible();

    // 6. Click 'Edit contributor', check pre-filled fields, move the address, save; then clear Street in a second dialog.
    await page.getByRole('button', { name: 'Edit contributor' }).click();
    await expect(dialog.getByRole('textbox', { name: 'Street number' })).toHaveValue('10');
    await expect(dialog.getByRole('textbox', { name: 'Street', exact: true })).toHaveValue('Elm St');
    await expect(dialog.getByRole('textbox', { name: 'City' })).toHaveValue('Toronto');
    await expect(dialog.getByLabel('Province')).toHaveValue('ON');
    await expect(dialog.getByRole('textbox', { name: 'Postal code' })).toHaveValue('M5V 2T6');
    await expect(dialog.getByRole('textbox', { name: 'Country' })).toHaveValue('CA');
    await dialog.getByRole('textbox', { name: 'City' }).fill('Ottawa');
    await dialog.getByRole('textbox', { name: 'Postal code' }).fill('K1A 0B1');
    await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill(`E2E row 22 move ${sfx}`);
    const saveButton = dialog.getByRole('button', { name: 'Save changes' });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(page.getByText('Address: 10 Elm St, Ottawa ON K1A 0B1, CA')).toBeVisible();
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Edit contributor' }).click();
    await dialog.getByRole('textbox', { name: 'Street', exact: true }).fill('');
    // A reason is entered so the address rule is the only thing blocking Save.
    await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill(`E2E row 22 clear street ${sfx}`);
    await expect(dialog.getByText(partialMessage)).toBeVisible();
    await expect(saveButton).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();

    // 7. Record a $25 payment for the contributor and open the contribution.
    await page.goto('/payments/new');
    await page.getByRole('textbox', { name: 'Donor who paid' }).fill(lastName);
    await page.getByRole('option', { name: new RegExp(`Edith ${lastName}`) }).click();
    await page.getByRole('textbox', { name: 'Amount ($)' }).first().fill('25');
    await page.getByRole('textbox', { name: 'Received on' }).fill('2025-03-15');
    await page.getByLabel('Period').selectOption('2025 General Election');
    await page.getByRole('textbox', { name: 'Reason (required)' }).fill(`E2E row 22 payment ${sfx}`);
    await page.getByRole('button', { name: 'Save payment' }).click();
    await page.getByRole('link', { name: 'Open the contribution' }).click();
    await expect(page.getByText('Address on file')).toBeVisible();
    await expect(page.getByText('10 Elm St, Ottawa ON K1A 0B1, CA')).toBeVisible();
  });
});
