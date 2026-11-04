// spec: specs/eo-validation.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Validation and Controls', () => {
  test('Row 32: Work queue identifies the Anonymous donor as ineligible (B3)', async ({ page }) => {
    // 1. Sign in as admin.
    await signIn(page, 'admin');

    // 2. Go to /work-queue and look at every row whose Donor is 'Anonymous'.
    await page.goto('/work-queue');
    await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
    const b3Rows = page
      .getByRole('row')
      .filter({ hasText: 'Anonymous' })
      .filter({ hasText: '(B3)' });
    await expect(b3Rows.first()).toBeVisible();
    await expect(b3Rows.first()).toContainText('Donor is anonymous or unidentifiable');
    await expect(b3Rows.first()).toContainText('OPEN');

    // 3. Open the Contribution link of an Anonymous B3 row.
    await b3Rows.first().getByRole('link', { name: 'Contribution' }).click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    // Several Anonymous links appear on the page (payment and contribution cards).
    await expect(page.getByRole('link', { name: 'Anonymous' }).first()).toBeVisible();
    const b3Item = page
      .getByRole('row')
      .filter({ hasText: 'Donor is anonymous or unidentifiable (B3)' });
    await expect(b3Item).toBeVisible();
    await expect(b3Item).toContainText('OPEN');
  });
});
