// spec: specs/eo-security.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Security', () => {
  test('Row 7: Admin creates a new role and it appears in the change log', async ({ page }) => {
    const sfx = Date.now().toString(36);
    const roleName = `Riding Auditor ${sfx}`;
    const reason = 'Create auditor role for EO demo';

    // 1. Sign in as sysadmin and open Admin then Roles (/admin/roles).
    await signIn(page, 'sysadmin');
    await page.goto('/admin/roles');
    const table = page.getByRole('table');
    for (const builtIn of [
      'Bookkeeper',
      'Filer',
      'Organizer',
      'Party CFO',
      'Process owner',
      'Read only',
      'Receipt administrator',
      'Riding or campaign CFO',
      'Rules authority',
    ]) {
      const row = table.getByRole('row').filter({ hasText: builtIn }).filter({ hasText: 'Built-in' });
      await expect(row.first()).toBeVisible();
    }
    await expect(
      table.getByRole('row').filter({ hasText: 'System administrator' }).filter({ hasText: 'Locked' }),
    ).toBeVisible();

    // 2. Click 'New role'. Enter Name, Description, tick 'Read all records'. 'Create role' is disabled while Reason is empty.
    await page.getByRole('button', { name: 'New role' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Name' }).fill(roleName);
    await dialog.getByRole('textbox', { name: 'Description' }).fill('Reads records for audit');
    await dialog.getByLabel('Read all records').check();
    const createButton = dialog.getByRole('button', { name: 'Create role' });
    await expect(createButton).toBeDisabled();

    // 3. Enter Reason and click 'Create role'.
    await dialog.getByLabel('Reason for this change (required)').fill(reason);
    await expect(createButton).toBeEnabled();
    await createButton.click();
    await expect(dialog).toBeHidden();
    const newRow = table.getByRole('row').filter({ hasText: roleName });
    await expect(newRow).toContainText('Reads records for audit');
    await expect(newRow).toContainText('Read all records');
    await expect(newRow.getByRole('cell').nth(2)).toHaveText('0');
    await expect(table.getByRole('row').filter({ hasText: 'Built-in' }).first()).toBeVisible();

    // 4. Open Admin then Change log, choose Subject type 'Role'.
    await page.goto('/admin/change-log');
    await page.getByLabel('Subject type').selectOption('Role');
    const logRow = page.getByRole('row').filter({ hasText: reason }).filter({ hasText: roleName });
    await expect(logRow.first()).toBeVisible();
    await expect(logRow.first()).toContainText('Sys Admin');
    await expect(logRow.first()).toContainText('—'); // empty Before
    // The After cell truncates JSON at about 80 characters, so only the key and name are
    // visible; the permission key is cut off (the plan expected it to be shown).
    await expect(logRow.first()).toContainText(`"name":"${roleName}"`);

    // 5. Try to create another role with the same name.
    await page.goto('/admin/roles');
    await page.getByRole('button', { name: 'New role' }).click();
    await dialog.getByRole('textbox', { name: 'Name' }).fill(roleName);
    await dialog.getByLabel('Read all records').check();
    await dialog.getByLabel('Reason for this change (required)').fill(`Duplicate attempt ${sfx}`);
    await dialog.getByRole('button', { name: 'Create role' }).click();
    await expect(dialog.getByText(/already exists; choose another name/).first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(table.getByRole('row').filter({ hasText: roleName })).toHaveCount(1);
  });
});
