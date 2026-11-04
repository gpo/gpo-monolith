// spec: specs/eo-contributions.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Contributions', () => {
  test('Row 25: Live: payment directed to a leadership contestant', async ({ page }) => {
    const sfx = Date.now().toString(36);
    const donorName = `Contrib Leader${sfx}`;

    // 1. Sign in as admin.
    await signIn(page, 'admin');

    // 2. Go to /payments/new and add a new contributor with a full address.
    await page.goto('/payments/new');
    await page.getByRole('button', { name: 'Not on file? Add a new contributor' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'First name' }).fill('Contrib');
    await dialog.getByRole('textbox', { name: 'Last name' }).fill(`Leader${sfx}`);
    await dialog.getByRole('textbox', { name: 'Street number' }).fill('10');
    await dialog.getByRole('textbox', { name: 'Street', exact: true }).fill('Queen St');
    await dialog.getByRole('textbox', { name: 'City' }).fill('Toronto');
    await dialog.getByRole('textbox', { name: 'Postal code' }).fill('M5V 2T6');
    await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill(`e2e leadership ${sfx}`);
    const addContributor = dialog.getByRole('button', { name: 'Add contributor' });
    await expect(addContributor).toBeEnabled();
    await addContributor.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Donor who paid' })).toHaveValue(donorName);

    // 3. Fill the payment amount and received-on date; leave Method as Cheque.
    await page.getByRole('textbox', { name: 'Amount ($)' }).first().fill('500');
    await page.getByRole('textbox', { name: 'Received on' }).fill('2025-03-15');
    await expect(page.getByText('Covers the whole payment ($500.00)')).toBeVisible();
    const contributionAmount = page.getByRole('textbox', { name: 'Amount ($)' }).nth(1);
    await expect(contributionAmount).toBeDisabled();
    await expect(contributionAmount).toHaveValue('500');

    // 4. In the Contribution block choose Recipient 'Leadership contestant'.
    await page.getByLabel('Recipient').selectOption('Leadership contestant');
    const contestant = page.getByRole('textbox', { name: 'Leadership contestant' });
    await expect(contestant).toHaveAttribute('placeholder', 'Choose a contestant');
    await expect(page.getByRole('textbox', { name: 'Riding' })).toBeHidden();
    await expect(page.getByLabel('Period')).toContainText('Derived from the date: 2025 General Election');
    await expect(
      page.getByText('Agency contribution: GPO received it for another entity'),
    ).toBeVisible();

    // 5. Choose the contestant, fill Reason, and save the payment.
    await contestant.click();
    await page
      .getByRole('option', { name: 'Jordan Rivers (Fixture leadership contest (not real))' })
      .click();
    await page.getByRole('textbox', { name: 'Reason (required)' }).fill(`e2e leadership ${sfx}`);
    const savePayment = page.getByRole('button', { name: 'Save payment' });
    await expect(savePayment).toBeEnabled();
    await savePayment.click();
    await expect(page.getByRole('heading', { name: 'Payment recorded' })).toBeVisible();
    await expect(page.getByText('The payment and its contribution were recorded.')).toBeVisible();
    const openLink = page.getByRole('link', { name: 'Open the contribution' });
    await expect(openLink).toBeVisible();

    // 6. Click 'Open the contribution'.
    await openLink.click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    await expect(page.getByText('Leadership contestant: Jordan Rivers')).toBeVisible();
    await expect(page.getByText('agency', { exact: true })).toBeVisible();
    await expect(page.getByText('2025 General Election', { exact: true })).toBeVisible();
    await expect(page.getByText('3/15/2025', { exact: true })).toHaveCount(2); // payment Received on + Accepted on
    await expect(page.getByText('None.', { exact: true })).toBeVisible();
  });
});
