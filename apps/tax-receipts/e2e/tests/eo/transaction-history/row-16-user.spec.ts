// spec: specs/eo-transaction-history.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn, switchUser } from '../../helpers.js';

test.describe('Transaction History', () => {
  test('Row 16: The user who made the change is captured as the admin@ user', async ({ page }) => {
    const sfx = Date.now().toString(36);
    const lastName = `User${sfx}`;
    const reason = `Row16 user ${sfx}`;

    // 1. Sign in as admin, add the contributor, then edit the postal code to M4M 1A1
    await signIn(page, 'admin');
    await page.goto('/contributors');
    await page.getByRole('button', { name: 'Add a contributor' }).click();
    const addDialog = page.getByRole('dialog');
    await addDialog.getByLabel('First name').fill('Uma');
    await addDialog.getByLabel('Last name').fill(lastName);
    await addDialog.getByLabel('Street number').fill('10');
    await addDialog.getByLabel('Street', { exact: true }).fill('Elm St');
    await addDialog.getByLabel('City').fill('Toronto');
    await addDialog.getByLabel('Postal code').fill('M5V 2T6');
    await addDialog.getByLabel('Reason (required)').fill(`Row16 create ${sfx}`);
    await expect(addDialog.getByRole('button', { name: 'Add contributor' })).toBeEnabled();
    await addDialog.getByRole('button', { name: 'Add contributor' }).click();

    await expect(page).toHaveURL(/\/contributors\/[^/]+$/);
    const id = new URL(page.url()).pathname.split('/').pop()!;

    await page.getByRole('button', { name: 'Edit contributor' }).click();
    const editDialog = page.getByRole('dialog');
    await editDialog.getByLabel('Postal code').fill('M4M 1A1');
    await editDialog.getByLabel('Reason (required)').fill(reason);
    await expect(editDialog.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    await editDialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Address: 10 Elm St, Toronto ON M4M 1A1, CA')).toBeVisible();

    // 2. Sign in as sysadmin (admin@ cannot see the Change log), go to /admin/change-log,
    //    filter by the contributor id
    await switchUser(page, 'sysadmin');
    await page.goto('/admin/change-log');
    await page.getByLabel('Subject id').fill(id);
    const createRow = page.getByRole('row').filter({ hasText: `Row16 create ${sfx}` });
    const editRow = page.getByRole('row').filter({ hasText: reason });
    await expect(createRow).toHaveCount(1);
    await expect(editRow).toHaveCount(1);
    // Cells: At, Subject, Actor, Reason, Before, After.
    await expect(createRow.getByRole('cell').nth(2)).toHaveText('Receipt Administrator');
    await expect(editRow.getByRole('cell').nth(2)).toHaveText('Receipt Administrator');
    await expect(page.getByRole('cell', { name: 'system', exact: true })).toHaveCount(0);

    // 3. Read the actor user id from the API, then filter by it
    const response = await page.request.get(`/api/change-log?subjectId=${id}`);
    const { data } = await response.json();
    const entry = data.find((e: { reason: string }) => e.reason === reason);
    const actorUserId: string = entry.actorUserId;
    expect(actorUserId).toBeTruthy();

    await page.getByLabel('Subject id').fill('');
    await page.getByLabel('Actor user id').fill(actorUserId);
    await expect(page.getByRole('row').filter({ hasText: reason })).toHaveCount(1);
    // Every visible row is by the admin user: no other users, no 'system' rows.
    // Poll until the filtered list has settled (no non-admin actor cell remains).
    const actorCells = page.getByRole('row').filter({ has: page.getByRole('cell') }).locator('td:nth-child(3)');
    await expect(actorCells.first()).toHaveText('Receipt Administrator');
    await expect(actorCells.filter({ hasNotText: 'Receipt Administrator' })).toHaveCount(0);

    // 4. Reload the explorer as sysadmin and look up the same admin user id: the entry is still
    //    attributed to the admin user, not to the sysadmin who is reading the log
    await page.goto('/admin/change-log');
    await page.getByLabel('Actor user id').fill(actorUserId);
    const sysEditRow = page.getByRole('row').filter({ hasText: reason });
    await expect(sysEditRow).toHaveCount(1);
    await expect(sysEditRow.getByRole('cell').nth(2)).toHaveText('Receipt Administrator');
    await expect(sysEditRow).not.toContainText('Sys Admin');
  });
});
