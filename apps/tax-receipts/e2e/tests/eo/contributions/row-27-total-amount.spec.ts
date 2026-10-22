// spec: specs/eo-contributions.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Contributions', () => {
  test('Row 27: Total amount recorded on contribution and parent payment', async ({ page }) => {
    // 1. Sign in as admin.
    await signIn(page, 'admin');

    // 2. Open the Agency Alex $150.00 contribution (period 9503).
    await page.goto('/contributions');
    await page
      .getByRole('row', { name: /Agency Alex.*\$150\.00/ })
      .getByRole('link', { name: 'Agency Alex' })
      .click();
    await expect(page.getByRole('heading', { name: 'Contribution' })).toBeVisible();

    // The first "Amount" label belongs to the Payment card, the second to the Contribution card.
    const amountValue = (index: number) =>
      page
        .getByText('Amount', { exact: true })
        .nth(index)
        .locator('xpath=following-sibling::*[1]');

    await expect(amountValue(0)).toHaveText('$150.00');
    await expect(amountValue(1)).toHaveText('$150.00');
    const receiptRow = page.getByRole('row', { name: /GPO-\d+.*ISSUED.*\$150\.00/ });
    await expect(receiptRow).toBeVisible();

    // 3. Go back and open the Split Sam $300.00 (Party) contribution.
    await page.getByRole('link', { name: '← Back to list' }).click();
    await page
      .getByRole('row', { name: /Split Sam.*\$300\.00/ })
      .getByRole('link', { name: 'Split Sam' })
      .click();
    await expect(page.getByText('Split across 2 contributions:')).toBeVisible();

    await expect(amountValue(0)).toHaveText('$500.00');
    await expect(amountValue(1)).toHaveText('$300.00');

    const splitBlock = page
      .locator('div')
      .filter({ hasText: /Split across 2 contributions:[\s\S]*\$300\.00[\s\S]*\$200\.00/ })
      .last();
    await expect(splitBlock).toContainText('$300.00');
    await expect(splitBlock).toContainText('$200.00');
  });
});
