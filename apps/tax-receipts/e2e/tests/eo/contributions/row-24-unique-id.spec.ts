// spec: specs/eo-contributions.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Contributions', () => {
  test('Row 24: Each contribution has a unique id shown in its detail URL', async ({ page }) => {
    // 1. Sign in as admin.
    await signIn(page, 'admin');
    await page.goto('/contributions');
    await expect(page.getByRole('heading', { name: 'Contributions', level: 2 })).toBeVisible();
    for (const name of [
      'Date',
      'Donor',
      'Amount',
      'Period',
      'Riding',
      'Entity',
      'Received by',
      'Agency',
      'Source code',
      'Non-deductible',
      'Receipt',
      'Open flags',
    ]) {
      await expect(page.getByRole('columnheader', { name, exact: true })).toBeVisible();
    }

    // 2. Click the 'Agency Alex' link in the row with amount $150.00 and period 9503. Record the URL.
    await page
      .getByRole('row', { name: /Agency Alex/ })
      .filter({ hasText: '$150.00' })
      .filter({ hasText: '9503' })
      .getByRole('link', { name: 'Agency Alex' })
      .click();
    await expect(page).toHaveURL(/\/contributions\/[A-Za-z0-9]+$/);
    const firstUrl = page.url();
    const firstId = firstUrl.split('/').pop() ?? '';
    expect(firstId.length).toBeGreaterThan(0);
    await expect(page.getByRole('heading', { name: 'Contribution', level: 2 })).toBeVisible();
    await expect(page.getByText('Agency Alex').first()).toBeVisible();
    await expect(page.getByText(/Individual, contributor id T\d+/)).toBeVisible();

    // 3. Click '← Back to list', then click the 'Direct Dee' link in the row with amount $120.00 and period 9503. Record the URL.
    await page.getByText('← Back to list').click();
    await expect(page).toHaveURL(/\/contributions$/);
    await page
      .getByRole('row', { name: /Direct Dee/ })
      .filter({ hasText: '$120.00' })
      .filter({ hasText: '9503' })
      .getByRole('link', { name: 'Direct Dee' })
      .click();
    await expect(page).toHaveURL(/\/contributions\/[A-Za-z0-9]+$/);
    const secondUrl = page.url();
    expect(secondUrl).not.toBe(firstUrl);
    expect(secondUrl.split('/').pop()).not.toBe(firstId);

    // 4. Reload the first URL directly.
    await page.goto(firstUrl);
    await expect(page.getByRole('heading', { name: 'Contribution', level: 2 })).toBeVisible();
    await expect(page.getByText('Agency Alex').first()).toBeVisible();
    await expect(page.getByText('$150.00').first()).toBeVisible();
  });
});
