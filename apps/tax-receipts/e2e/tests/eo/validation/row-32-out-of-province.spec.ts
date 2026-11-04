// spec: specs/eo-validation.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Validation and Controls', () => {
  test('Row 32: Work queue identifies the Out Of Province Donor as ineligible (B1)', async ({ page }) => {
    // 1. Sign in as admin.
    await signIn(page, 'admin');

    // 2. Go to /work-queue. The Validation tab is the active tab by default.
    await page.goto('/work-queue');
    await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
    for (const name of ['Validation', 'Diff queue', 'Owed to EO', 'Sync incidents', 'Delivery']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    }
    for (const name of ['Subject', 'Donor', 'Rule', 'Opened', 'Due', 'Status', 'Resolution']) {
      await expect(page.getByRole('columnheader', { name, exact: true })).toBeVisible();
    }

    // 3. Find the row whose Donor is 'Out Of Province Donor' and whose Rule text contains '(B1)'.
    const b1Row = page
      .getByRole('row')
      .filter({ hasText: 'Out Of Province Donor' })
      .filter({ hasText: '(B1)' });
    await expect(b1Row).toHaveCount(1);
    await expect(b1Row).toContainText("Donor's address is out of province");
    await expect(b1Row).toContainText('(B1)');
    await expect(b1Row).toContainText('OPEN');
    await expect(b1Row.getByRole('button', { name: 'Resolve' })).toBeVisible();
    await expect(b1Row.getByRole('button', { name: 'Exception' })).toBeVisible();

    // 4. Click the 'Contribution' link in that row.
    await b1Row.getByRole('link', { name: 'Contribution' }).click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    await expect(page.getByText('456 Robson St, Vancouver BC V6B 1A1, CA')).toBeVisible();
    const workItem = page
      .getByRole('row')
      .filter({ hasText: "Donor's address is out of province (B1)" });
    await expect(workItem).toContainText('OPEN');
  });
});
