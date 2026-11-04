// spec: specs/eo-security.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Security', () => {
  test('Row 10: Sysadmin role is assignable, including to a newly created user', async ({ page }) => {
    const sfx = Date.now().toString(36);
    const name = `E2E Second Admin ${sfx}`;
    const email = `e2e-admin2-${sfx}@gpo.test`;
    const password = 'second-admin-12345';

    // 1. Sign in as sysadmin and open Admin, Users.
    await signIn(page, 'sysadmin');
    await page.goto('/admin/users');
    const sysadminRow = page.getByRole('row').filter({ hasText: 'sysadmin@gpo.test' });
    await expect(sysadminRow).toContainText('System administrator');

    // 2. Click 'New user', enter details, choose Role 'System administrator', click 'Create user'.
    await page.getByRole('button', { name: 'New user' }).click();
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Email (used to sign in)').fill(email);
    await page.getByLabel('Temporary password').fill(password);
    await page.getByLabel('Role').selectOption('System administrator');
    await page.getByRole('button', { name: 'Create user' }).click();
    const newRow = page.getByRole('row').filter({ hasText: email });
    await expect(newRow).toContainText('System administrator');
    await expect(newRow).toContainText('Active');

    // 3. Sign out and sign in as the new user. Open Admin, Users.
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeHidden();

    await page.goto('/admin/users');
    await expect(page.getByRole('button', { name: 'New user' })).toBeVisible();
    await expect(
      page.getByRole('row').filter({ hasText: email }).getByRole('button', { name: 'Edit' }),
    ).toBeVisible();

    await page.goto('/admin/roles');
    const roleRow = page.getByRole('row').filter({ hasText: 'System administrator' });
    // Shared database: at least the seeded sysadmin and the new user.
    await expect(roleRow.getByRole('cell').nth(2)).toHaveText(/^([2-9]|\d{2,})$/);
  });
});
