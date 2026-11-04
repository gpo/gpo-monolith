// spec: specs/eo-transaction-history.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { changeField, openChangeEntry, signIn, switchUser } from '../../helpers.js';

test.describe('Transaction History', () => {
  test('Row 19: Audit on new records - contributor creation then address edit', async ({ page }) => {
    const sfx = Date.now().toString(36);
    const lastName = `Create${sfx}`;
    const createReason = `Row19 create ${sfx}`;
    const addressReason = `Row19 address ${sfx}`;

    // 1. Sign in as admin, go to /contributors, click 'Add a contributor', fill the form, click 'Add contributor'.
    await signIn(page, 'admin');
    await page.goto('/contributors');
    await page.getByRole('button', { name: 'Add a contributor' }).click();
    const addDialog = page.getByRole('dialog');
    await addDialog.getByRole('textbox', { name: 'First name' }).fill('Carla');
    await addDialog.getByRole('textbox', { name: 'Last name' }).fill(lastName);
    await addDialog.getByRole('textbox', { name: 'Street number' }).fill('10');
    await addDialog.getByRole('textbox', { name: 'Street', exact: true }).fill('Elm St');
    await addDialog.getByRole('textbox', { name: 'City' }).fill('Toronto');
    await addDialog.getByRole('textbox', { name: 'Postal code' }).fill('M5V 2T6');
    await addDialog.getByRole('textbox', { name: 'Reason (required)' }).fill(createReason);
    const addButton = addDialog.getByRole('button', { name: 'Add contributor' });
    await expect(addButton).toBeEnabled();
    await addButton.click();
    await expect(page).toHaveURL(/\/contributors\/[^/]+$/);
    const contributorId = new URL(page.url()).pathname.split('/').pop()!;
    await expect(page.getByText('Address: 10 Elm St, Toronto ON M5V 2T6, CA')).toBeVisible();

    // 2. In the Change history panel click 'Show 1 change'.
    // The plan expected the panel to start collapsed; in the live app it can already be
    // expanded ("Hide"), so only click the toggle when it is offered.
    const showOne = page.getByRole('button', { name: 'Show 1 change' });
    if (await showOne.isVisible()) await showOne.click();
    const historyRows = page.locator('tbody tr').filter({ hasText: 'Row19' });
    await expect(historyRows).toHaveCount(1);
    const createRow = historyRows.filter({ hasText: createReason });
    await expect(createRow.getByRole('cell').nth(1)).toHaveText('Receipt Administrator');
    await expect(createRow.getByRole('cell').nth(2)).toHaveText(createReason);
    // Cells: At, By, Reason, Changes. A creation has no before, so it is summarized as "Created".
    await expect(createRow.getByRole('cell').nth(3)).toHaveText('Created');
    const createDialog = await openChangeEntry(page, createRow);
    await expect(changeField(createDialog, 'name').getByRole('cell').nth(2)).toHaveText('—');
    await expect(changeField(createDialog, 'name').getByRole('cell').nth(3)).toHaveText(`Carla ${lastName}`);
    await expect(changeField(createDialog, 'addresses.0.street').getByRole('cell').nth(3)).toHaveText('Elm St');
    await createDialog.getByRole('button', { name: 'Close' }).click();
    await expect(createDialog).toBeHidden();

    // 3. Click 'Edit contributor', change Street number to '55' and Street to 'Birch Rd', Reason, save.
    await page.getByRole('button', { name: 'Edit contributor' }).click();
    const editDialog = page.getByRole('dialog');
    await editDialog.getByRole('textbox', { name: 'Street number' }).fill('55');
    await editDialog.getByRole('textbox', { name: 'Street', exact: true }).fill('Birch Rd');
    await editDialog.getByRole('textbox', { name: 'Reason (required)' }).fill(addressReason);
    const saveButton = editDialog.getByRole('button', { name: 'Save changes' });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByText('Address: 55 Birch Rd, Toronto ON M5V 2T6, CA')).toBeVisible();
    const showTwo = page.getByRole('button', { name: 'Show 2 changes' });
    if (await showTwo.isVisible()) await showTwo.click();
    await expect(historyRows).toHaveCount(2);
    const newest = historyRows.first();
    await expect(newest.getByRole('cell').nth(1)).toHaveText('Receipt Administrator');
    await expect(newest.getByRole('cell').nth(2)).toHaveText(addressReason);
    await expect(newest.getByRole('cell').nth(3)).toContainText('addresses.0.street');
    await expect(newest.getByRole('cell').nth(3)).toContainText('addresses.0.housenumber');
    const editDialogEntry = await openChangeEntry(page, newest);
    const street = changeField(editDialogEntry, 'addresses.0.street');
    await expect(street.getByRole('cell').nth(2)).toHaveText('Elm St');
    await expect(street.getByRole('cell').nth(3)).toHaveText('Birch Rd');
    const houseNumber = changeField(editDialogEntry, 'addresses.0.housenumber');
    await expect(houseNumber.getByRole('cell').nth(2)).toHaveText('10');
    await expect(houseNumber.getByRole('cell').nth(3)).toHaveText('55');
    await editDialogEntry.getByRole('button', { name: 'Close' }).click();
    await expect(editDialogEntry).toBeHidden();

    // 4. Sign in as sysadmin (admin@ cannot see the Change log), go to /admin/change-log,
    //    and filter 'Subject id' = <id>.
    await switchUser(page, 'sysadmin');
    await page.goto('/admin/change-log');
    await page.getByRole('textbox', { name: 'Subject id' }).fill(contributorId);
    const logRows = page.locator('tbody tr');
    await expect(logRows).toHaveCount(2);
    await expect(logRows.first()).toContainText(`Contact (${contributorId})`);
    await expect(logRows.first()).toContainText('Receipt Administrator');
    await expect(logRows.first()).toContainText(addressReason);
    await expect(logRows.last()).toContainText(`Contact (${contributorId})`);
    await expect(logRows.last()).toContainText('Receipt Administrator');
    await expect(logRows.last()).toContainText(createReason);
  });
});
