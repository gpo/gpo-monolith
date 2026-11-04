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
  test('Row 12: A user changes their own password and other sessions are signed out', async ({
    page,
    browser,
    baseURL,
  }) => {
    const sfx = Date.now().toString(36);
    const name = `E2E Pwd Self ${sfx}`;
    const email = `e2e-pwdself-${sfx}@gpo.test`;
    const initial = 'pwd-initial-12345';
    const changed = 'pwd-changed-67890';

    // 1. Create the user as sysadmin, then sign out.
    await signIn(page, 'sysadmin');
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'New user' }).click();
    await page.getByRole('textbox', { name: 'Name' }).fill(name);
    await page.getByRole('textbox', { name: 'Email (used to sign in)' }).fill(email);
    await page.getByRole('textbox', { name: 'Temporary password' }).fill(initial);
    await page.getByRole('button', { name: 'Create user' }).click();
    await expect(page.getByRole('cell', { name: email })).toBeVisible();
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    // 2. Open two browser contexts A and B and sign in as the new user in both.
    const ctxA = await browser.newContext({ baseURL });
    const ctxB = await browser.newContext({ baseURL });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await signInAs(pageA, email, initial);
    await signInAs(pageB, email, initial);
    await expect(pageA.getByRole('button', { name: 'Account menu' })).toBeVisible();
    await expect(pageB.getByRole('button', { name: 'Account menu' })).toBeVisible();

    // 3. In A open Account menu then 'Change password'; short new password.
    await pageA.getByRole('button', { name: 'Account menu' }).click();
    await pageA.getByRole('menuitem', { name: 'Change password' }).click();
    const dialog = pageA.getByRole('dialog');
    const submit = dialog.getByRole('button', { name: 'Change password' });
    await dialog.getByLabel('Current password').fill(initial);
    await dialog.getByLabel('New password', { exact: true }).fill('short');
    await dialog.getByLabel('Confirm new password').fill('short');
    await expect(dialog.getByText('At least 12 characters')).toBeVisible();
    await expect(submit).toBeDisabled();

    // 4. New password and a different confirmation.
    await dialog.getByLabel('New password', { exact: true }).fill(changed);
    await dialog.getByLabel('Confirm new password').fill('different-67890');
    await expect(dialog.getByText('Does not match the new password')).toBeVisible();
    await expect(submit).toBeDisabled();

    // 5. Wrong current password with matching new passwords and submit.
    await dialog.getByLabel('Confirm new password').fill(changed);
    await dialog.getByLabel('Current password').fill('wrong-current-12345');
    await submit.click();
    await expect(dialog.getByRole('alert')).toContainText('current password is incorrect');

    // 6. Correct current password and matching new passwords, then submit.
    await dialog.getByLabel('Current password').fill(initial);
    await submit.click();
    // The plan expected the alert to mention other sessions being signed out; the app
    // shows only 'Your password has been changed.' (the dialog's note says it beforehand).
    await expect(dialog.getByRole('alert')).toContainText('Your password has been changed.');
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();

    // 7. In B reload the page.
    await pageB.reload();
    await expect(pageB.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    // 8. In A reload the page.
    await pageA.reload();
    await expect(pageA.getByRole('button', { name: 'Account menu' })).toBeVisible();

    // 9. In a fresh context sign in with the old password, then the new one.
    const ctxC = await browser.newContext({ baseURL });
    const pageC = await ctxC.newPage();
    await pageC.goto('/login');
    await pageC.getByLabel('Email').fill(email);
    await pageC.getByLabel('Password').fill(initial);
    await pageC.getByRole('button', { name: 'Sign in' }).click();
    await expect(pageC.getByText('Invalid email or password.')).toBeVisible();
    await expect(pageC.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await pageC.getByLabel('Password').fill(changed);
    await pageC.getByRole('button', { name: 'Sign in' }).click();
    await expect(pageC.getByRole('heading', { name: 'Sign in' })).toBeHidden();
    await expect(pageC.getByRole('button', { name: 'Account menu' })).toBeVisible();

    // 10. As sysadmin open Admin, Change log, Subject type 'User'.
    await signIn(page, 'sysadmin');
    await page.goto('/admin/change-log');
    await page.getByLabel('Subject type').selectOption('User');
    const entry = page
      .getByRole('row')
      .filter({ hasText: name })
      .filter({ hasText: 'changed own password' });
    await expect(entry).toBeVisible();
    // Actor is the user themselves; no password or hash is displayed.
    await expect(entry).not.toContainText(initial);
    await expect(entry).not.toContainText(changed);
    await expect(entry).not.toContainText(/\$2[aby]\$/);
    // The row only summarizes the entry; its dialog records the change as a flag, not a value.
    const entryDialog = await openChangeEntry(page, entry);
    await expect(changeField(entryDialog, 'passwordChanged')).toContainText('true');
    await expect(entryDialog).not.toContainText(initial);
    await expect(entryDialog).not.toContainText(changed);
    await expect(entryDialog).not.toContainText(/\$2[aby]\$/);

    await ctxA.close();
    await ctxB.close();
    await ctxC.close();
  });
});
