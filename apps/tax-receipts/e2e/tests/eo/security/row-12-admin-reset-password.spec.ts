// spec: specs/eo-security.md
// seed: tests/seed.spec.ts

import { test, expect, type Page } from '@playwright/test';
import { changeField, openChangeEntry, signIn } from '../../helpers.js';

async function signInAs(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeHidden();
}

test.describe('Security', () => {
  test("Row 12: Admin resets a user's password and signs them out everywhere", async ({
    page,
    browser,
    baseURL,
  }) => {
    const sfx = Date.now().toString(36);
    const name = `E2E Pwd Reset ${sfx}`;
    const email = `e2e-pwdreset-${sfx}@gpo.test`;
    const initial = 'reset-initial-12345';
    const temp = 'reset-temp-67890-ab';
    const reason = `Forgot password ${sfx}`;

    // 1. Context A: sysadmin creates the user.
    await signIn(page, 'sysadmin');
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'New user' }).click();
    await page.getByRole('textbox', { name: 'Name' }).fill(name);
    await page.getByRole('textbox', { name: 'Email (used to sign in)' }).fill(email);
    await page.getByRole('textbox', { name: 'Temporary password' }).fill(initial);
    await page.getByRole('button', { name: 'Create user' }).click();
    const userRow = page.getByRole('row').filter({ hasText: email });
    await expect(userRow).toBeVisible();
    await expect(userRow.getByRole('cell', { name: 'Active' })).toBeVisible();

    // 2. Contexts B and C: sign in as the new user in both.
    const ctxB = await browser.newContext({ baseURL });
    const ctxC = await browser.newContext({ baseURL });
    const pageB = await ctxB.newPage();
    const pageC = await ctxC.newPage();
    await signInAs(pageB, email, initial);
    await signInAs(pageC, email, initial);
    await expect(pageB.getByRole('button', { name: 'Account menu' })).toBeVisible();
    await expect(pageC.getByRole('button', { name: 'Account menu' })).toBeVisible();

    // 3. In A click 'Reset password'; short password, then a valid one, with Reason empty.
    await userRow.getByRole('button', { name: 'Reset password' }).click();
    const dialog = page.getByRole('dialog');
    const submit = dialog.getByRole('button', { name: 'Reset password' });
    await dialog.getByLabel('Temporary password').fill('short');
    await expect(submit).toBeDisabled();
    await dialog.getByLabel('Temporary password').fill(temp);
    await expect(submit).toBeDisabled();

    // 4. Enter the reason and submit.
    await dialog.getByLabel('Reason (required)').fill(reason);
    await expect(submit).toBeEnabled();
    await submit.click();
    // The dialog switches to a success state that says the user is signed out everywhere;
    // close it with Done.
    await expect(dialog.getByText(/^Password reset, and .+ is signed out everywhere\./)).toBeVisible();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();

    // 5. Reload B and C. An admin reset signs the user out of every open session
    // (user guide, accounts and access); the sysadmin's own session is unaffected.
    await pageB.reload();
    await expect(pageB.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await pageC.reload();
    await expect(pageC.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    // 6. A fresh sign-in (context D) refuses the old password and accepts the temporary one.
    const ctxD = await browser.newContext({ baseURL });
    const pageD = await ctxD.newPage();
    await pageD.goto('/login');
    await pageD.getByLabel('Email').fill(email);
    await pageD.getByLabel('Password').fill(initial);
    await pageD.getByRole('button', { name: 'Sign in' }).click();
    await expect(pageD.getByText('Invalid email or password.')).toBeVisible();
    await expect(pageD.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await pageD.getByLabel('Password').fill(temp);
    await pageD.getByRole('button', { name: 'Sign in' }).click();
    await expect(pageD.getByRole('heading', { name: 'Sign in' })).toBeHidden();
    await expect(pageD.getByRole('button', { name: 'Account menu' })).toBeVisible();

    // 7. In A open Admin, Change log, Subject type 'User'.
    await page.goto('/admin/change-log');
    await page.getByLabel('Subject type').selectOption('User');
    // The row shows the subject id rather than the user's name, so find it by the unique reason.
    const entry = page.getByRole('row').filter({ hasText: reason });
    await expect(entry).toBeVisible();
    await expect(entry).toContainText('Sys Admin');
    await expect(entry).not.toContainText(initial);
    await expect(entry).not.toContainText(temp);
    await expect(entry).not.toContainText(/\$2[aby]\$/);
    // The entry itself records the reset flag and the sessions closed, never a password or hash.
    const entryDialog = await openChangeEntry(page, entry);
    await expect(changeField(entryDialog, 'passwordReset')).toContainText('true');
    await expect(entryDialog).not.toContainText(initial);
    await expect(entryDialog).not.toContainText(temp);
    await expect(entryDialog).not.toContainText(/\$2[aby]\$/);

    await ctxB.close();
    await ctxC.close();
    await ctxD.close();
  });
});
