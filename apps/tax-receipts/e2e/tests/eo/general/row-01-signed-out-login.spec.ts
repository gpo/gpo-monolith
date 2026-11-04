// spec: specs/eo-general.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('General', () => {
  test('Row 1: Signed-out visit shows the sign-in form', async ({ page }) => {
    const signInHeading = page.getByRole('heading', { name: 'Sign in', level: 3 });
    const banner = page.getByRole('banner');

    // 1. In a fresh signed-out context, go to /contributions directly.
    await page.goto('/contributions');
    await expect(signInHeading).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Password' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(banner).toBeHidden();
    await expect(page.getByRole('link', { name: 'Contributions' })).toBeHidden();
    await expect(page.getByRole('table')).toBeHidden();
    await expect(page).toHaveURL(/\/contributions$/);

    // 2. Go to / and then to /admin while still signed out.
    await page.goto('/');
    await expect(signInHeading).toBeVisible();
    await expect(page.getByRole('table')).toBeHidden();

    await page.goto('/admin');
    await expect(signInHeading).toBeVisible();
    await expect(page.getByRole('table')).toBeHidden();

    // 3. Sign in with signIn(page, 'cfo') and go to /contributions.
    await signIn(page, 'cfo');
    await page.goto('/contributions');
    await expect(signInHeading).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Contributions', level: 2 })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
  });
});
