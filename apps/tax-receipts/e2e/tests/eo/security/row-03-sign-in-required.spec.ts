// spec: specs/eo-security.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { SEEDED_PASSWORD } from '../../helpers.js';

test.describe('Security', () => {
  test('Row 3: Sign-in form is required and a bad password is refused', async ({ page }) => {
    const heading = page.getByRole('heading', { name: 'Sign in' });
    const email = page.getByLabel('Email');
    const password = page.getByLabel('Password');
    const signInButton = page.getByRole('button', { name: 'Sign in' });
    const header = page.getByRole('banner');

    // 1. Open http://localhost:5174/ signed out.
    await page.goto('/');
    await expect(heading).toBeVisible();
    await expect(email).toBeVisible();
    await expect(password).toBeVisible();
    await expect(signInButton).toBeVisible();
    await expect(header.getByRole('link', { name: 'Contributions' })).toBeHidden();
    await expect(header.getByRole('link', { name: 'Admin' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeHidden();

    // 2. Navigate directly to /admin/users and /contributions while signed out.
    await page.goto('/admin/users');
    await expect(heading).toBeVisible();
    await expect(page.getByRole('button', { name: 'New user' })).toBeHidden();
    await page.goto('/contributions');
    await expect(heading).toBeVisible();
    await expect(header.getByRole('link', { name: 'Admin' })).toBeHidden();

    // 3. Enter sysadmin@gpo.test with a wrong password and click 'Sign in'.
    await email.fill('sysadmin@gpo.test');
    await password.fill('wrong-password-123456');
    await signInButton.click();
    await expect(page.getByRole('alert')).toContainText('Invalid email or password.');
    await expect(heading).toBeVisible();
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeHidden();

    // 4. Leave both fields empty and click 'Sign in'.
    // The form refuses with native required-field validation (no request is sent).
    await email.fill('');
    await password.fill('');
    await signInButton.click();
    await expect(heading).toBeVisible();
    await expect(email).toBeFocused();
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeHidden();

    // 5. Enter sysadmin@gpo.test with the correct password and click 'Sign in'.
    await email.fill('sysadmin@gpo.test');
    await password.fill(SEEDED_PASSWORD);
    await signInButton.click();
    await expect(heading).toBeHidden();
    await expect(header.getByRole('link', { name: 'Contributions' })).toBeVisible();
    await expect(header.getByRole('link', { name: 'Contributors' })).toBeVisible();
    await expect(header.getByRole('link', { name: 'Admin' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
  });
});
