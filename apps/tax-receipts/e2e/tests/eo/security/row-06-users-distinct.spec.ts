// spec: specs/eo-security.md
// seed: tests/seed.spec.ts

import { expect, test, type Page } from '@playwright/test';
import { changeField, openChangeEntry, signIn } from '../../helpers.js';

async function signInAs(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeHidden();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

async function createUser(page: Page, name: string, email: string, password: string) {
  await page.getByRole('button', { name: 'New user' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
  await dialog.getByRole('textbox', { name: 'Email (used to sign in)' }).fill(email);
  await dialog.getByRole('textbox', { name: 'Temporary password' }).fill(password);
  await expect(dialog.getByRole('combobox', { name: 'Role' })).toHaveValue(/.+/);
  await dialog.getByRole('button', { name: 'Create user' }).click();
  return dialog;
}

test.describe('Security', () => {
  test('Row 6: Users are listed distinctly and duplicates are kept apart', async ({ page }) => {
    const sfx = Date.now().toString(36);
    const twinName = `E2E Twin ${sfx}`;
    const emailA = `e2e-twin-a-${sfx}@gpo.test`;
    const emailB = `e2e-twin-b-${sfx}@gpo.test`;
    const editedName = `E2E Twin B Edited ${sfx}`;
    const password = 'twin-pass-12345';

    // 1. Sign in as sysadmin and create both twins via 'New user' with the identical Name.
    await signIn(page, 'sysadmin');
    await page.goto('/admin/users');
    const dialog = await createUser(page, twinName, emailA, password);
    await expect(dialog).toBeHidden();
    await createUser(page, twinName, emailB, password);
    await expect(dialog).toBeHidden();
    const rowA = page.getByRole('row', { name: new RegExp(emailA) });
    const rowB = page.getByRole('row', { name: new RegExp(emailB) });
    await expect(rowA).toBeVisible();
    await expect(rowB).toBeVisible();
    await expect(rowA.getByRole('cell', { name: twinName, exact: true })).toBeVisible();
    await expect(rowB.getByRole('cell', { name: twinName, exact: true })).toBeVisible();

    // 2. Try to create a third user with an email already in use.
    await createUser(page, `E2E Twin Dupe ${sfx}`, emailA, password);
    await expect(dialog.getByRole('alert')).toContainText(/already has the email/);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('row', { name: new RegExp(`E2E Twin Dupe ${sfx}`) })).toHaveCount(0);

    // 3. Sign out; sign in as twin B and rename via Account menu, Edit profile.
    await signOut(page);
    await signInAs(page, emailB, password);
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Edit profile' }).click();
    const profile = page.getByRole('dialog');
    await profile.getByRole('textbox', { name: 'Name' }).fill(editedName);
    await profile.getByRole('button', { name: 'Save' }).click();
    await expect(profile).toBeHidden();

    // 4. Sign out, sign in as sysadmin, and check the Change log (subject type 'User').
    await signOut(page);
    await signIn(page, 'sysadmin');
    await page.goto('/admin/change-log');
    await page.getByLabel('Subject type').selectOption('User');
    // The Actor cell shows the user's current name, so B's edit is found by the edited name.
    const editEntry = page
      .getByRole('row')
      .filter({ hasText: 'updated own profile' })
      .filter({ hasText: editedName });
    await expect(editEntry).toHaveCount(1);
    await expect(editEntry.getByRole('cell', { name: editedName, exact: true })).toBeVisible();
    // The row lists the one changed field; the dialog shows old and new, and with the
    // unchanged fields revealed, B's email (not A's).
    await expect(editEntry.getByRole('cell').last()).toContainText('name');
    const subject = (await editEntry.getByRole('cell').nth(1).innerText()).trim();
    expect(subject).toMatch(/^User \(\w+\)$/);
    const editDialog = await openChangeEntry(page, editEntry);
    await expect(changeField(editDialog, 'name').getByRole('cell').nth(2)).toHaveText(twinName);
    await expect(changeField(editDialog, 'name').getByRole('cell').nth(3)).toHaveText(editedName);
    await editDialog.getByRole('button', { name: /^Show \d+ unchanged fields$/ }).click();
    await expect(changeField(editDialog, 'email').getByRole('cell').nth(3)).toHaveText(emailB);
    await expect(editDialog).not.toContainText(emailA);
    await editDialog.getByRole('button', { name: 'Close' }).click();
    await expect(editDialog).toBeHidden();
    // The subject id matches one "user account created" entry, and that id is not shared
    // with the other twin's creation entry.
    await expect(
      page.getByRole('row').filter({ hasText: 'user account created' }).filter({ hasText: subject }),
    ).toHaveCount(1);

    await page.goto('/admin/users');
    await expect(
      page.getByRole('row', { name: new RegExp(emailA) }).getByRole('cell', { name: twinName, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('row', { name: new RegExp(emailB) }).getByRole('cell', { name: editedName, exact: true }),
    ).toBeVisible();
  });
});
