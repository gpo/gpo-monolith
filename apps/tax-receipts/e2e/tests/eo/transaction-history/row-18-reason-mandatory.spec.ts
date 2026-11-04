// spec: specs/eo-transaction-history.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn, switchUser } from '../../helpers.js';

test.describe('Transaction History', () => {
  test('Row 18: A reason is mandatory and recorded as the task description', async ({ page }) => {
    const sfx = Date.now().toString(36);
    const createReason = `Row18 create ${sfx}`;
    const taskReason = `Row18 task ${sfx}`;

    // 1. Sign in as admin, go to /contributors, click 'Add a contributor', fill First name and
    //    Last name but leave 'Reason (required)' blank.
    await signIn(page, 'admin');
    await page.goto('/contributors');
    await page.getByRole('button', { name: 'Add a contributor' }).click();
    const addDialog = page.getByRole('dialog');
    await addDialog.getByLabel('First name').fill('Rhea');
    await addDialog.getByLabel('Last name').fill(`Reason${sfx}`);
    // The plan fills the address in the edit step; the live edit dialog needs a city to change,
    // so the address is filled here.
    await addDialog.getByLabel('Street number').fill('10');
    await addDialog.getByLabel('Street', { exact: true }).fill('Elm St');
    await addDialog.getByLabel('City').fill('Toronto');
    await addDialog.getByLabel('Postal code').fill('M5V 2T6');
    await expect(addDialog.getByRole('button', { name: 'Add contributor' })).toBeDisabled();

    // 2. Fill Reason 'Row18 create <suffix>' and add the contributor. On the new record click
    //    'Edit contributor', change City to 'London' and leave 'Reason (required)' blank.
    await addDialog.getByLabel('Reason (required)').fill(createReason);
    await expect(addDialog.getByRole('button', { name: 'Add contributor' })).toBeEnabled();
    await addDialog.getByRole('button', { name: 'Add contributor' }).click();
    await expect(page).toHaveURL(/\/contributors\/[^/]+$/);
    const id = new URL(page.url()).pathname.split('/').pop()!;
    await page.getByRole('button', { name: 'Edit contributor' }).click();
    const editDialog = page.getByRole('dialog');
    await editDialog.getByLabel('City').fill('London');
    await expect(editDialog.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    // 3. Type Reason 'Row18 task <suffix>'.
    await editDialog.getByLabel('Reason (required)').fill(taskReason);
    await expect(editDialog.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    await editDialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // 4. Sign in as sysadmin (admin@ cannot see the Change log), go to /admin/change-log,
    //    filter 'Subject id' = <id>.
    await switchUser(page, 'sysadmin');
    await page.goto('/admin/change-log');
    await page.getByLabel('Subject id').fill(id);
    const editRow = page.getByRole('row').filter({ hasText: taskReason });
    await expect(editRow.getByRole('cell', { name: taskReason, exact: true })).toBeVisible();
    const createRow = page.getByRole('row').filter({ hasText: createReason });
    await expect(createRow.getByRole('cell', { name: createReason, exact: true })).toBeVisible();
  });
});
