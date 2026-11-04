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

test.describe('Security', () => {
  test('Row 5: Admin edits a user and the User change-log entry shows before and after', async ({
    page,
  }) => {
    const sfx = Date.now().toString(36);
    const oldName = `E2E Editable ${sfx}`;
    const oldEmail = `e2e-editable-${sfx}@gpo.test`;
    const newName = `E2E Renamed ${sfx}`;
    const newEmail = `e2e-renamed-${sfx}@gpo.test`;
    const selfName = `E2E Self Edited ${sfx}`;
    const selfEmail = `e2e-self-${sfx}@gpo.test`;
    const password = 'editable-pass-12345';
    const reason = 'Fix name and email for audit demo';

    // 1. Sign in as sysadmin; create the user at Admin, Users, 'New user' (role Read only).
    await signIn(page, 'sysadmin');
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'New user' }).click();
    await page.getByRole('textbox', { name: 'Name' }).fill(oldName);
    await page.getByRole('textbox', { name: 'Email (used to sign in)' }).fill(oldEmail);
    await page.getByRole('textbox', { name: 'Temporary password' }).fill(password);
    await expect(page.getByRole('combobox', { name: 'Role' })).toHaveValue(/.+/);
    await page.getByRole('button', { name: 'Create user' }).click();
    const userRow = page.getByRole('row', { name: new RegExp(oldEmail) });
    await expect(userRow).toBeVisible();

    // 2. Click 'Edit'; 'Save' is disabled until a reason is entered.
    await userRow.getByRole('button', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog');
    const save = dialog.getByRole('button', { name: 'Save' });
    await expect(save).toBeDisabled();
    await dialog.getByRole('textbox', { name: 'Name' }).fill(newName);
    await dialog.getByRole('textbox', { name: 'Email (used to sign in)' }).fill(newEmail);
    await expect(save).toBeDisabled();

    // 3. Enter the reason and save.
    await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill(reason);
    await expect(save).toBeEnabled();
    await save.click();
    await expect(dialog).toBeHidden();
    const renamedRow = page.getByRole('row', { name: new RegExp(newEmail) });
    await expect(renamedRow).toBeVisible();
    await expect(renamedRow.getByRole('cell', { name: newName, exact: true })).toBeVisible();

    // 4. Change log, Subject type 'User': newest row for that user.
    await page.goto('/admin/change-log');
    await page.getByLabel('Subject type').selectOption('User');
    const editEntry = page.getByRole('row').filter({ hasText: reason });
    await expect(editEntry).toHaveCount(1);
    await expect(editEntry.getByRole('cell', { name: 'Sys Admin', exact: true })).toBeVisible();
    await expect(editEntry.getByRole('cell', { name: reason, exact: true })).toBeVisible();
    // The row lists the changed fields; the entry dialog shows old and new for each.
    await expect(editEntry.getByRole('cell').last()).toContainText('name');
    await expect(editEntry.getByRole('cell').last()).toContainText('email');
    const subject = (await editEntry.getByRole('cell').nth(1).innerText()).trim();
    const userId = /^User \((\w+)\)$/.exec(subject)?.[1];
    expect(userId).toBeTruthy();
    const editDialog = await openChangeEntry(page, editEntry);
    await expect(changeField(editDialog, 'name').getByRole('cell').nth(2)).toHaveText(oldName);
    await expect(changeField(editDialog, 'name').getByRole('cell').nth(3)).toHaveText(newName);
    await expect(changeField(editDialog, 'email').getByRole('cell').nth(2)).toHaveText(oldEmail);
    await expect(changeField(editDialog, 'email').getByRole('cell').nth(3)).toHaveText(newEmail);
    await editDialog.getByRole('button', { name: 'Close' }).click();
    await expect(editDialog).toBeHidden();

    // 5. Sign out, sign in as the renamed user, Edit profile: change Name only.
    await signOut(page);
    await signInAs(page, newEmail, password);
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Edit profile' }).click();
    const profile = page.getByRole('dialog');
    await profile.getByRole('textbox', { name: 'Name' }).fill(selfName);
    await profile.getByRole('button', { name: 'Save' }).click();
    await expect(profile).toBeHidden();
    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.getByRole('menu', { name: 'Account menu' })).toContainText(selfName);

    // 6. Edit profile again: change Email; a current password is required.
    await page.getByRole('menuitem', { name: 'Edit profile' }).click();
    await profile.getByRole('textbox', { name: 'Email (used to sign in)' }).fill(selfEmail);
    const currentPassword = profile.getByRole('textbox', { name: 'Current password' });
    await expect(currentPassword).toBeVisible();
    await currentPassword.fill('wrong-password-99999');
    await profile.getByRole('button', { name: 'Save' }).click();
    await expect(profile.getByRole('alert')).toBeVisible();
    await expect(profile).toBeVisible();

    // 7. Correct current password and save; sign out and sign in with the new email.
    await currentPassword.fill(password);
    await profile.getByRole('button', { name: 'Save' }).click();
    await expect(profile).toBeHidden();
    await signOut(page);
    await signInAs(page, selfEmail, password);
    await signOut(page);

    await signIn(page, 'sysadmin');
    await page.goto('/admin/change-log');
    await page.getByLabel('Subject type').selectOption('User');
    // The rows show the subject id rather than the user's name, so narrow to this user by id.
    await page.getByLabel('Subject id').fill(userId!);
    const selfEntries = page.getByRole('row').filter({ hasText: 'updated own profile' });
    await expect(selfEntries).toHaveCount(2);
    const nameEntry = selfEntries.filter({ has: page.getByRole('cell', { name: /\bname\b/ }) });
    await expect(nameEntry).toHaveCount(1);
    const nameDialog = await openChangeEntry(page, nameEntry);
    await expect(changeField(nameDialog, 'name').getByRole('cell').nth(3)).toHaveText(selfName);
    await nameDialog.getByRole('button', { name: 'Close' }).click();
    await expect(nameDialog).toBeHidden();
    const emailEntry = selfEntries.filter({ has: page.getByRole('cell', { name: /\bemail\b/ }) });
    await expect(emailEntry).toHaveCount(1);
    const emailDialog = await openChangeEntry(page, emailEntry);
    await expect(changeField(emailDialog, 'email').getByRole('cell').nth(3)).toHaveText(selfEmail);
  });
});
