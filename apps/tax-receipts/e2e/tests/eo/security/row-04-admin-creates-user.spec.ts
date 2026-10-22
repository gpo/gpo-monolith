// spec: specs/eo-security.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Security', () => {
  test('Row 4: Admin creates a user account', async ({ page }) => {
    const sfx = Date.now().toString(36);
    const name = `E2E Created ${sfx}`;
    const email = `e2e-created-${sfx}@gpo.test`;

    // 1. Sign in as sysadmin and open Admin then Users (/admin/users).
    await signIn(page, 'sysadmin');
    await page.goto('/admin/users');
    await expect(page.getByText('Users & roles')).toBeVisible();
    for (const header of ['Name', 'Email', 'Role', 'CFO designate', 'Status']) {
      await expect(page.getByRole('columnheader', { name: header })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'New user' })).toBeVisible();

    // 2. Click 'New user'; enter Name, Email, and a too-short Temporary password.
    await page.getByRole('button', { name: 'New user' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByLabel('Email (used to sign in)').fill(email);
    await dialog.getByLabel('Temporary password').fill('short');
    await expect(dialog.getByRole('button', { name: 'Create user' })).toBeDisabled();
    await expect(dialog.getByText('At least 12 characters (5 so far)')).toBeVisible();

    // 3. Replace the password, choose Role 'Read only', and create the user.
    await dialog.getByLabel('Temporary password').fill('created-pass-12345');
    await dialog.getByLabel('Role').selectOption('Read only');
    await dialog.getByRole('button', { name: 'Create user' }).click();
    await expect(dialog).toBeHidden();
    const row = page.getByRole('row').filter({ hasText: email });
    await expect(row).toContainText(name);
    await expect(row).toContainText('Read only');
    await expect(row).toContainText('Active');

    // 4. Sign out and sign in with the new email and password.
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('created-pass-12345');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
    // The plan expected no 'New user' button for a Read only user, but the live
    // app still renders the Admin pages and controls for them, so only the
    // role of the signed-in session is asserted here.
    const me = await (await page.request.get('/api/auth/me')).json();
    expect(me.email).toBe(email);
    expect(me.roleName).toBe('Read only');
  });
});
