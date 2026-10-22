// spec: specs/eo-security.md
// seed: tests/seed.spec.ts

import { test, expect, type Page } from '@playwright/test';
import { signIn } from '../../helpers.js';

async function signInAs(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe('Security', () => {
  test('Row 11: Deactivated accounts cannot sign in and open sessions are dropped', async ({
    page,
    browser,
    baseURL,
  }) => {
    const sfx = Date.now().toString(36);
    const name = `E2E Deactivate ${sfx}`;
    const email = `e2e-deactivate-${sfx}@gpo.test`;
    const password = 'deactivate-pass-12345';

    // 1. Context A: sign in as sysadmin and create the user (role Read only).
    await signIn(page, 'sysadmin');
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'New user' }).click();
    await page.getByRole('textbox', { name: 'Name' }).fill(name);
    await page.getByLabel('Email (used to sign in)').fill(email);
    await page.getByLabel('Temporary password').fill(password);
    await page.getByRole('button', { name: 'Create user' }).click();
    const row = page.getByRole('row', { name: new RegExp(email) });
    await expect(row).toBeVisible();
    await expect(row.getByRole('cell', { name: 'Active', exact: true })).toBeVisible();

    // 2. Context B: sign in as the new user and leave Contributions open.
    const contextB = await browser.newContext({ baseURL });
    const pageB = await contextB.newPage();
    await signInAs(pageB, email, password);
    await expect(pageB.getByRole('heading', { name: 'Sign in' })).toBeHidden();
    await pageB.goto('/contributions');
    await expect(pageB.getByRole('banner').getByRole('link', { name: 'Contributions' })).toBeVisible();

    // 3. In A, untick Active with a reason and save.
    await row.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('checkbox', { name: 'Active (inactive users cannot sign in)' }).click();
    await page.getByLabel('Reason (required)').fill(`Left the party ${sfx}`);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByRole('cell', { name: 'Inactive', exact: true })).toBeVisible();

    // 4. In B, reload: the session is dropped.
    await pageB.reload();
    await expect(pageB.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    // 5. In B, sign in again with the correct password: refused.
    await signInAs(pageB, email, password);
    await expect(pageB.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(pageB.getByRole('banner').getByRole('link', { name: 'Contributions' })).toBeHidden();

    // 6. In A, re-tick Active with a reason and save; B can then sign in.
    await row.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('checkbox', { name: 'Active (inactive users cannot sign in)' }).click();
    await page.getByLabel('Reason (required)').fill(`Rejoined the party ${sfx}`);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByRole('cell', { name: 'Active', exact: true })).toBeVisible();

    await signInAs(pageB, email, password);
    await expect(pageB.getByRole('heading', { name: 'Sign in' })).toBeHidden();
    await expect(pageB.getByRole('banner').getByRole('link', { name: 'Contributions' })).toBeVisible();

    await page.goto('/admin/change-log');
    await page.getByLabel('Subject type').selectOption('User');
    await expect(page.getByRole('row', { name: new RegExp(`Left the party ${sfx}`) })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(`Rejoined the party ${sfx}`) })).toBeVisible();

    await contextB.close();
  });
});
