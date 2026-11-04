// spec: specs/eo-contributions.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Contributions', () => {
  test('Row 30: Accepted date shows day, month, and year', async ({ page }) => {
    // 1. Sign in as admin.
    await signIn(page, 'admin');

    // 2. Open Contributions and find the Agency Alex row.
    await page.getByRole('banner').getByRole('link', { name: 'Contributions' }).click();
    const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Agency Alex' }) });
    await expect(row.getByRole('cell', { name: '3/1/2029', exact: true })).toBeVisible();

    // 3. Open the contribution.
    await row.getByRole('link', { name: 'Agency Alex' }).click();
    // Detail values sit in the element right after their label paragraph.
    const valueAfter = (label: string) =>
      page.getByText(label, { exact: true }).locator('xpath=following-sibling::*[1]');
    await expect(valueAfter('Accepted on')).toHaveText('3/1/2029');
    await expect(valueAfter('Received on')).toHaveText('3/1/2029');
  });
});
