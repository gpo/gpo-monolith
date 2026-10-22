// spec: specs/eo-contributions.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Contributions', () => {
  test('Row 29: Goods Gita shows goods and services with a non-deductible amount', async ({ page }) => {
    // 1. Sign in as admin.
    await signIn(page, 'admin');

    // 2. On the Contributions list find the Goods Gita row.
    await page.getByRole('banner').getByRole('link', { name: 'Contributions' }).click();
    const table = page.getByRole('table');
    const gitaRow = table.getByRole('row').filter({ hasText: 'Goods Gita' });
    await expect(gitaRow).toHaveCount(1);
    await expect(gitaRow.getByRole('cell', { name: '$100.00', exact: true })).toBeVisible();
    // Non-deductible is the 11th column (checkbox, Date, Donor, Amount, Period, Riding,
    // Entity, Received by, Agency, Source code, Non-deductible).
    await expect(gitaRow.getByRole('cell').nth(10)).toHaveText('$20.00');
    const emmaRow = table.getByRole('row').filter({ hasText: 'Email Emma' });
    await expect(emmaRow).toHaveCount(1);
    await expect(emmaRow.getByRole('cell').nth(10)).toHaveText('—');

    // 3. Open Goods Gita.
    await gitaRow.getByRole('link', { name: 'Goods Gita' }).click();
    const main = page.getByRole('main');
    await expect(main.getByText('Donor received goods or services', { exact: true })).toBeVisible();
    const goods = main.getByText('Donor received goods or services', { exact: true }).locator('xpath=..');
    const nonDeductible = main.getByText('Non-deductible', { exact: true }).locator('xpath=..');
    const recipient = main.getByText('Recipient', { exact: true }).locator('xpath=..');
    await expect(goods).toContainText('Yes');
    await expect(nonDeductible).toContainText('$20.00');
    await expect(recipient).toContainText('Party (province-wide)');
    await expect(main.getByText('$100.00').first()).toBeVisible();

    // 4. Go back and open Agency Alex for contrast.
    await page.getByRole('link', { name: '← Back to list' }).click();
    await page.getByRole('table').getByRole('link', { name: 'Agency Alex' }).click();
    await expect(page.getByRole('main').getByText('Donor received goods or services', { exact: true })).toBeVisible();
    const goodsAlex = page.getByRole('main').getByText('Donor received goods or services', { exact: true }).locator('xpath=..');
    const nonDeductibleAlex = page.getByRole('main').getByText('Non-deductible', { exact: true }).locator('xpath=..');
    await expect(goodsAlex).toContainText('No');
    await expect(nonDeductibleAlex).toContainText('$0.00');
  });
});
