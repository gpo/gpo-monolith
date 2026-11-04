// spec: specs/eo-transaction-history.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { changeField, openChangeEntry, signIn, switchUser } from '../../helpers.js';

test.describe('Transaction History', () => {
  test("Row 15: Old value is captured in 'before' on the same entry", async ({ page }) => {
    const sfx = Date.now().toString(36);
    const lastName = `Oldval${sfx}`;
    const reason = `Row15 old value ${sfx}`;

    // 1. Sign in as admin, add the contributor, then edit its city to Hamilton
    await signIn(page, 'admin');
    await page.goto('/contributors');
    await page.getByRole('button', { name: 'Add a contributor' }).click();
    const addDialog = page.getByRole('dialog');
    await addDialog.getByLabel('First name').fill('Olga');
    await addDialog.getByLabel('Last name').fill(lastName);
    await addDialog.getByLabel('Street number').fill('10');
    await addDialog.getByLabel('Street', { exact: true }).fill('Elm St');
    await addDialog.getByLabel('City').fill('Toronto');
    await addDialog.getByLabel('Postal code').fill('M5V 2T6');
    await addDialog.getByLabel('Reason (required)').fill(`Row15 create ${sfx}`);
    await expect(addDialog.getByRole('button', { name: 'Add contributor' })).toBeEnabled();
    await addDialog.getByRole('button', { name: 'Add contributor' }).click();

    await expect(page).toHaveURL(/\/contributors\/[^/]+$/);
    const id = new URL(page.url()).pathname.split('/').pop()!;

    await page.getByRole('button', { name: 'Edit contributor' }).click();
    const editDialog = page.getByRole('dialog');
    await editDialog.getByLabel('City').fill('Hamilton');
    await editDialog.getByLabel('Reason (required)').fill(reason);
    await expect(editDialog.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    await editDialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Address: 10 Elm St, Hamilton ON M5V 2T6, CA')).toBeVisible();

    // 2. Sign in as sysadmin (admin@ cannot see the Change log), go to /admin/change-log,
    //    filter by the contributor id, locate the edit row
    await switchUser(page, 'sysadmin');
    await page.goto('/admin/change-log');
    await page.getByLabel('Subject id').fill(id);
    const row = page.getByRole('row').filter({ hasText: reason });
    await expect(row).toHaveCount(1);
    // The row lists the changed field; the entry dialog shows its old value in the Before cell.
    await expect(row.getByRole('cell').last()).toContainText('addresses.0.city');
    const entryDialog = await openChangeEntry(page, row);
    const cityField = changeField(entryDialog, 'addresses.0.city');
    // Cells: Field, kind badge, Before, After.
    await expect(cityField.getByRole('cell').nth(2)).toHaveText('Toronto');
    await expect(cityField.getByRole('cell').nth(3)).toHaveText('Hamilton');
    await entryDialog.getByRole('button', { name: 'Close' }).click();
    await expect(entryDialog).toBeHidden();

    const response = await page.request.get(`/api/change-log?subjectId=${id}`);
    const { data } = await response.json();
    const entry = data.find((e: { reason: string }) => e.reason === reason);
    expect(entry.before.addresses[0].city).toBe('Toronto');
    expect(entry.after.addresses[0].city).toBe('Hamilton');

    // 3. Open the contributor page and show the change history
    await page.goto(`/contributors/${id}`);
    await page.getByRole('button', { name: 'Show 2 changes' }).click();
    const editRow = page.getByRole('row').filter({ hasText: reason });
    await expect(editRow).toHaveCount(1);
    const historyDialog = await openChangeEntry(page, editRow);
    const historyCity = changeField(historyDialog, 'addresses.0.city');
    await expect(historyCity.getByRole('cell').nth(2)).toHaveText('Toronto');
    await expect(historyCity.getByRole('cell').nth(3)).toHaveText('Hamilton');
    await historyDialog.getByRole('button', { name: 'Close' }).click();
    await expect(historyDialog).toBeHidden();
    // The create entry has no old value: it is summarized as "Created", and every field is added
    const createRow = page.getByRole('row').filter({ hasText: `Row15 create ${sfx}` });
    await expect(createRow).toHaveCount(1);
    await expect(createRow.getByRole('cell').last()).toHaveText('Created');
    const createDialog = await openChangeEntry(page, createRow);
    const createCity = changeField(createDialog, 'addresses.0.city');
    await expect(createCity.getByRole('cell').nth(2)).toHaveText('—');
    await expect(createCity.getByRole('cell').nth(3)).toHaveText('Toronto');
  });
});
