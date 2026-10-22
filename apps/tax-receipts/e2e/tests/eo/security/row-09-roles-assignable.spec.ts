// spec: specs/eo-security.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

const BUILT_IN_ROLES = [
  'Bookkeeper',
  'Filer',
  'Organizer',
  'Party CFO',
  'Process owner',
  'Read only',
  'Receipt administrator',
  'Riding or campaign CFO',
  'Rules authority',
  'System administrator',
];

test.describe('Security', () => {
  test('Row 9: Roles are assignable to users, including custom roles, and shared by many users', async ({ page }) => {
    const sfx = Date.now().toString(36);
    const roleName = `E2E Shared Role ${sfx}`;
    const oneName = `E2E Holder One ${sfx}`;
    const twoName = `E2E Holder Two ${sfx}`;

    const roleRow = () => page.getByRole('row', { name: new RegExp(roleName) });
    const userRow = (name: string) => page.getByRole('row', { name: new RegExp(name) });
    // Users is the third column of the Roles table.
    const roleUserCount = () => roleRow().getByRole('cell').nth(2);

    async function createUser(name: string, email: string, role: string) {
      await page.getByRole('button', { name: 'New user' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
      await dialog.getByRole('textbox', { name: 'Email (used to sign in)' }).fill(email);
      await dialog.getByRole('textbox', { name: 'Temporary password' }).fill('holder-pass-12345');
      await dialog.getByLabel('Role').selectOption(role);
      await dialog.getByRole('button', { name: 'Create user' }).click();
      await expect(dialog).toBeHidden();
    }

    async function changeRole(name: string, role: string, reason: string) {
      await userRow(name).getByRole('button', { name: 'Edit' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Role').selectOption(role);
      await dialog.getByLabel('Reason (required)').fill(reason);
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog).toBeHidden();
    }

    // 1. Sign in as sysadmin; create the custom role with permission 'View entity reports', reason 'Shared role'.
    await signIn(page, 'sysadmin');
    await page.goto('/admin/roles');
    await page.getByRole('button', { name: 'New role' }).click();
    const roleDialog = page.getByRole('dialog');
    await roleDialog.getByLabel('Name').fill(roleName);
    await roleDialog.getByLabel('View entity reports').check();
    await roleDialog.getByLabel('Reason for this change (required)').fill(`Shared role ${sfx}`);
    await roleDialog.getByRole('button', { name: 'Create role' }).click();
    await expect(roleDialog).toBeHidden();
    await expect(roleRow()).toBeVisible();
    await expect(roleUserCount()).toHaveText('0');

    // 2. Go to Admin, Users and click 'New user'. Open the Role select.
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'New user' }).click();
    const newUserDialog = page.getByRole('dialog');
    const roleSelect = newUserDialog.getByLabel('Role');
    for (const name of [...BUILT_IN_ROLES, roleName]) {
      await expect(roleSelect.getByRole('option', { name, exact: true })).toHaveCount(1);
    }
    await newUserDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(newUserDialog).toBeHidden();

    // 3. Create Holder One with the custom role and Holder Two with 'Read only'.
    await createUser(oneName, `e2e-holder-one-${sfx}@gpo.test`, roleName);
    await createUser(twoName, `e2e-holder-two-${sfx}@gpo.test`, 'Read only');
    await expect(userRow(oneName)).toContainText(roleName);
    await expect(userRow(twoName)).toContainText('Read only');

    // 4. Edit Holder Two: choose the custom role, reason 'Assign shared role', Save.
    await userRow(twoName).getByRole('button', { name: 'Edit' }).click();
    const editDialog = page.getByRole('dialog');
    await expect(editDialog.getByLabel('Role').getByRole('option', { name: roleName, exact: true })).toHaveCount(1);
    await editDialog.getByLabel('Role').selectOption(roleName);
    await editDialog.getByLabel('Reason (required)').fill(`Assign shared role ${sfx}`);
    await editDialog.getByRole('button', { name: 'Save' }).click();
    await expect(editDialog).toBeHidden();
    await expect(userRow(oneName)).toContainText(roleName);
    await expect(userRow(twoName)).toContainText(roleName);

    // 5. Open Admin, Roles.
    await page.goto('/admin/roles');
    await expect(roleUserCount()).toHaveText('2');

    // 6. Edit Holder Two back to 'Read only' with a reason.
    await page.goto('/admin/users');
    await changeRole(twoName, 'Read only', `Back to read only ${sfx}`);
    await expect(userRow(twoName)).toContainText('Read only');
    await expect(userRow(twoName)).not.toContainText(roleName);
    await page.goto('/admin/roles');
    await expect(roleUserCount()).toHaveText('1');
  });
});
