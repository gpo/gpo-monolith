// spec: specs/eo-contributors.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Contributors', () => {
  test('Row 20: Every contributor shows a numeric Contributor id, and Qomon contacts show their Qomon contact id separately', async ({ page }) => {
    // 1. Sign in as admin. Go to /contributors. Click the link 'Baseline Donor'.
    await signIn(page, 'admin');
    await page.goto('/contributors');
    await page.getByRole('link', { name: 'Baseline Donor' }).click();

    await expect(page.getByRole('heading', { name: 'Baseline Donor' })).toBeVisible();
    // one id format for EO (#170): the tool's own number, not the Qomon id
    await expect(page.getByText(/^Contributor id: \d{8,10}$/)).toBeVisible();
    await expect(page.getByText('Qomon contact: 800001')).toBeVisible();
    await expect(
      page.getByText('This is a Qomon contact and Qomon is not connected here, so it cannot be edited in this tool.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit contributor' })).toHaveCount(0);

    // 2. Go to /contributors and click the link 'Email Emma'. Do not edit.
    await page.goto('/contributors');
    await page.getByRole('link', { name: 'Email Emma' }).click();

    await expect(page.getByRole('heading', { name: 'Email Emma' })).toBeVisible();
    await expect(page.getByText(/^Contributor id: \d{8,10}$/)).toBeVisible();
    await expect(page.getByText('Qomon contact: none (kept in this tool)')).toBeVisible();
  });
});
