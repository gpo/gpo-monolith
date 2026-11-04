// spec: specs/eo-transaction-history.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { changeField, openChangeEntry, signIn, switchUser } from '../../helpers.js';

test.describe('Transaction History', () => {
  test("Row 14: New value is captured in 'after' on a live edit", async ({ page }) => {
    const sfx = Date.now().toString(36);
    const lastName = `Newval${sfx}`;
    const reason = `Row14 new value ${sfx}`;

    // 1. Sign in as admin, add the contributor, then edit its city to Ottawa
    await signIn(page, 'admin');
    await page.goto('/contributors');
    await page.getByRole('button', { name: 'Add a contributor' }).click();
    const addDialog = page.getByRole('dialog');
    await addDialog.getByLabel('First name').fill('Nina');
    await addDialog.getByLabel('Last name').fill(lastName);
    await addDialog.getByLabel('Street number').fill('10');
    await addDialog.getByLabel('Street', { exact: true }).fill('Elm St');
    await addDialog.getByLabel('City').fill('Toronto');
    await addDialog.getByLabel('Postal code').fill('M5V 2T6');
    await addDialog.getByLabel('Reason (required)').fill(`Row14 create ${sfx}`);
    await expect(addDialog.getByRole('button', { name: 'Add contributor' })).toBeEnabled();
    await addDialog.getByRole('button', { name: 'Add contributor' }).click();

    await expect(page).toHaveURL(/\/contributors\/[^/]+$/);
    const id = new URL(page.url()).pathname.split('/').pop()!;

    await page.getByRole('button', { name: 'Edit contributor' }).click();
    const editDialog = page.getByRole('dialog');
    await editDialog.getByLabel('City').fill('Ottawa');
    await editDialog.getByLabel('Reason (required)').fill(reason);
    await expect(editDialog.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    await editDialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Address: 10 Elm St, Ottawa ON M5V 2T6, CA')).toBeVisible();

    // 2. Sign in as sysadmin (admin@ cannot see the Change log), go to /admin/change-log, and filter by the contributor id
    await switchUser(page, 'sysadmin');
    await page.goto('/admin/change-log');
    await page.getByLabel('Subject id').fill(id);
    const row = page.getByRole('row').filter({ hasText: reason });
    await expect(row).toHaveCount(1);
    // The row summarizes the change by field name; the entry dialog shows the new value
    await expect(row.getByRole('cell').last()).toContainText('addresses.0.city');
    const entryDialog = await openChangeEntry(page, row);
    await expect(changeField(entryDialog, 'addresses.0.city')).toContainText('Ottawa');
    await entryDialog.getByRole('button', { name: 'Close' }).click();
    await expect(entryDialog).toBeHidden();

    const response = await page.request.get(`/api/change-log?subjectId=${id}`);
    const { data } = await response.json();
    const entry = data.find((e: { reason: string }) => e.reason === reason);
    expect(entry.after.addresses[0].city).toBe('Ottawa');

    // 3. Open the contributor page and show the change history
    await page.goto(`/contributors/${id}`);
    await page.getByRole('button', { name: 'Show 2 changes' }).click();
    const historyRow = page.getByRole('row').filter({ hasText: reason });
    await expect(historyRow).toHaveCount(1);
    await expect(historyRow.getByRole('cell').last()).toContainText('addresses.0.city');
    // The newest row is first in the body
    await expect(page.getByRole('row').nth(1)).toContainText(reason);
    const historyDialog = await openChangeEntry(page, historyRow);
    await expect(changeField(historyDialog, 'addresses.0.city')).toContainText('Ottawa');
  });
});
