// spec: specs/eo-validation.md
// seed: tests/seed.spec.ts

import { expect, test, type Page } from '@playwright/test';
import { signIn } from '../../helpers.js';

async function addPayment(page: Page, donor: string, receivedOn: string, reason: string) {
  await page.getByRole('textbox', { name: 'Donor who paid' }).fill(donor);
  await page.getByRole('option', { name: donor }).click();
  await page.getByRole('textbox', { name: 'Amount ($)' }).first().fill('50');
  await page.getByRole('textbox', { name: 'Received on' }).fill(receivedOn);
  await page.getByRole('textbox', { name: 'Reason (required)' }).fill(reason);
  await page.getByRole('button', { name: 'Save payment' }).click();
  await expect(page.getByRole('heading', { name: 'Payment recorded' })).toBeVisible();
}

test.describe('Validation and Controls', () => {
  test('Row 37: Resolve a duplicate contribution as EXCEPTION (distinct gifts)', async ({ page }) => {
    const sfx = Date.now().toString(36);
    const lastName = `Distinct${sfx}`;
    const donor = `Dblprobe ${lastName}`;

    // 1. Sign in as admin.
    await signIn(page, 'admin');

    // 2. Create the contributor and both payments (period 64, 2025-03-15 and 2025-03-16).
    await page.goto('/payments/new');
    await page.getByRole('button', { name: 'Not on file? Add a new contributor' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'First name' }).fill('Dblprobe');
    await dialog.getByRole('textbox', { name: 'Last name' }).fill(lastName);
    await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill(`e2e row 37 exception contributor ${sfx}`);
    await dialog.getByRole('button', { name: 'Add contributor' }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('textbox', { name: 'Amount ($)' }).first().fill('50');
    await page.getByRole('textbox', { name: 'Received on' }).fill('2025-03-15');
    await page.getByRole('textbox', { name: 'Reason (required)' }).fill(`e2e row 37 first gift ${sfx}`);
    await page.getByRole('button', { name: 'Save payment' }).click();
    await expect(page.getByRole('heading', { name: 'Payment recorded' })).toBeVisible();

    await page.goto('/payments/new');
    await addPayment(page, donor, '2025-03-16', `e2e row 37 second gift ${sfx}`);

    // 3. Go to /work-queue, find the A6 row, and click Exception.
    await page.goto('/work-queue');
    const a6Row = page.getByRole('row').filter({ hasText: lastName }).filter({ hasText: '(A6)' });
    await expect(a6Row).toHaveCount(1);
    await expect(a6Row.getByRole('cell', { name: 'OPEN' })).toBeVisible();
    await expect(a6Row.getByRole('button', { name: 'Exception' })).toBeEnabled();
    await a6Row.getByRole('button', { name: 'Exception' }).click();
    const modal = page.getByRole('dialog', { name: 'Record an exception' });
    await expect(modal.getByRole('textbox', { name: 'Exception reason' })).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Record exception' })).toBeDisabled();
    await expect(modal.getByRole('button', { name: 'Cancel' })).toBeVisible();

    // 4. Type 'distinct gifts' and record it.
    await modal.getByRole('textbox', { name: 'Exception reason' }).fill('distinct gifts');
    await expect(modal.getByRole('button', { name: 'Record exception' })).toBeEnabled();
    await modal.getByRole('button', { name: 'Record exception' }).click();
    await expect(modal).toBeHidden();
    await expect(a6Row.getByRole('cell', { name: 'EXCEPTION' })).toBeVisible();
    await expect(a6Row.getByRole('cell', { name: 'distinct gifts' })).toBeVisible();

    // 5. Reload /work-queue.
    await page.reload();
    const reloaded = page.getByRole('row').filter({ hasText: lastName }).filter({ hasText: '(A6)' });
    await expect(reloaded.getByRole('cell', { name: 'EXCEPTION' })).toBeVisible();
    await expect(reloaded.getByRole('cell', { name: 'distinct gifts' })).toBeVisible();

    // Both contributions remain (nothing refunded). Not run live: filter the contributions list by donor.
    await page.goto('/contributions');
    await page.getByRole('textbox', { name: 'Donor (name or email)' }).fill(lastName);
    await expect(page.getByRole('row').filter({ hasText: lastName })).toHaveCount(2);
    await expect(page.getByRole('row').filter({ hasText: '3/15/2025' })).toContainText('$50.00');
    await expect(page.getByRole('row').filter({ hasText: '3/16/2025' })).toContainText('$50.00');
  });
});
