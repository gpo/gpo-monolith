// spec: specs/eo-contributions.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Contributions', () => {
  test('Row 29: Live: goods-and-services payment with a non-deductible amount', async ({ page }) => {
    const sfx = Date.now().toString(36);

    // 1. Sign in as admin.
    await signIn(page, 'admin');

    // 2. Go to /payments/new, add a new contributor, fill Amount 100 and Received on 2025-03-15.
    await page.goto('/payments/new');
    await page.getByRole('button', { name: 'Not on file? Add a new contributor' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'First name' }).fill('Goods');
    await dialog.getByRole('textbox', { name: 'Last name' }).fill(`Live${sfx}`);
    await dialog.getByRole('textbox', { name: 'Street number' }).fill('13');
    await dialog.getByRole('textbox', { name: 'Street', exact: true }).fill('Queen St');
    await dialog.getByRole('textbox', { name: 'City' }).fill('Toronto');
    await dialog.getByRole('textbox', { name: 'Postal code' }).fill('M5V 2T6');
    await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill(`e2e goods ${sfx}`);
    const addContributor = dialog.getByRole('button', { name: 'Add contributor' });
    await expect(addContributor).toBeEnabled();
    await addContributor.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Donor who paid' })).toHaveValue(`Goods Live${sfx}`);
    await page.getByRole('textbox', { name: 'Amount ($)' }).first().fill('100');
    await page.getByRole('textbox', { name: 'Received on' }).fill('2025-03-15');

    // 3. Observe the Contribution block's 'Non-deductible ($)' field before ticking the checkbox.
    const nonDeductible = page.getByRole('textbox', { name: 'Non-deductible ($)' });
    await expect(nonDeductible).toBeDisabled();

    // 4. Tick 'Donor received goods or services'.
    await page.getByRole('checkbox', { name: 'Donor received goods or services' }).check();
    await expect(nonDeductible).toBeEnabled();

    // 5. Fill Non-deductible ($) with 20 and Reason, save, and open the contribution.
    await nonDeductible.fill('20');
    await page.getByRole('textbox', { name: 'Reason (required)' }).fill(`e2e goods ${sfx}`);
    const save = page.getByRole('button', { name: 'Save payment' });
    await expect(save).toBeEnabled();
    await save.click();
    await page.getByRole('link', { name: 'Open the contribution' }).click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);

    // Values sit in the sibling element after their label paragraph.
    const valueOf = (label: string) =>
      page.getByText(label, { exact: true }).locator('xpath=following-sibling::*[1]');
    await expect(valueOf('Donor received goods or services')).toHaveText('Yes');
    await expect(valueOf('Non-deductible')).toHaveText('$20.00');
    await expect(page.getByText('$100.00', { exact: true }).first()).toBeVisible();
    await expect(valueOf('Period')).toHaveText('2025 General Election');
  });
});
