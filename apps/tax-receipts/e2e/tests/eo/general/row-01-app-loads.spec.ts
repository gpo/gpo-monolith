// spec: specs/eo-general.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('General', () => {
  test('Row 1: Signed-in app loads with its navigation', async ({ page }) => {
    // 1. Sign in as cfo
    await signIn(page, 'cfo');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeHidden();
    await expect(page).toHaveURL(/\/$/);
    await expect(page).toHaveTitle('GPO Tax Receipts & Contributions');

    // 2. Inspect the top banner navigation
    const banner = page.getByRole('banner');
    await expect(banner.getByRole('link', { name: 'Contributions' })).toHaveAttribute('href', '/contributions');
    await expect(banner.getByRole('link', { name: 'Contributors' })).toHaveAttribute('href', '/contributors');
    await expect(banner.getByRole('link', { name: 'Work queue' })).toHaveAttribute('href', '/work-queue');
    await expect(banner.getByRole('link', { name: 'RTD filings' })).toHaveAttribute('href', '/rtd-filings');
    await expect(banner.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
    await expect(banner.getByRole('link', { name: 'Green Party of Ontario' })).toHaveAttribute('href', '/');
    await expect(banner.getByRole('button', { name: 'Account menu' })).toBeVisible();

    // 3. Inspect the main area of the home page
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Spaces', level: 2 })).toBeVisible();
    for (const name of ['Period', 'Riding', 'Entity', 'Stage', 'Stage owner', 'Contributions', 'Open flags']) {
      await expect(main.getByRole('columnheader', { name, exact: true })).toBeVisible();
    }
    await expect(
      main.getByRole('row').filter({ hasText: '2026 Annual' }).filter({ hasText: 'Party (province-wide)' }).first(),
    ).toBeVisible();

    // 4. Click the 'Contributions' navigation link
    await banner.getByRole('link', { name: 'Contributions' }).click();
    await expect(page).toHaveURL(/\/contributions$/);
    for (const name of ['Date', 'Donor', 'Amount', 'Period', 'Entity', 'Receipt']) {
      await expect(main.getByRole('columnheader', { name, exact: true })).toBeVisible();
    }
    await expect(main.getByRole('row').nth(1)).toBeVisible();

    // 5. Click the 'Contributors' navigation link
    await banner.getByRole('link', { name: 'Contributors' }).click();
    await expect(page).toHaveURL(/\/contributors$/);
    await expect(main.getByRole('textbox', { name: 'Search' })).toBeVisible();
    await expect(main.getByRole('row').nth(1)).toBeVisible();
  });
});
