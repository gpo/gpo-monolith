// spec: specs/eo-transaction-history.md
// seed: tests/seed.spec.ts

import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { signIn, switchUser } from '../../helpers.js';

test.describe('Transaction History', () => {
  test('Row 19: The change log export downloads as a CSV', async ({ page }) => {
    const sfx = Date.now().toString(36);

    // 1. Sign in as admin, add the contributor and edit its City to 'Barrie'
    await signIn(page, 'admin');
    await page.goto('/contributors');
    await page.getByRole('button', { name: 'Add a contributor' }).click();
    const addDialog = page.getByRole('dialog');
    await addDialog.getByLabel('First name').fill('Eve');
    await addDialog.getByLabel('Last name').fill(`Export${sfx}`);
    await addDialog.getByLabel('Street number').fill('10');
    await addDialog.getByLabel('Street', { exact: true }).fill('Elm St');
    await addDialog.getByLabel('City').fill('Toronto');
    await addDialog.getByLabel('Postal code').fill('M5V 2T6');
    await addDialog.getByLabel('Reason (required)').fill(`Row19x create ${sfx}`);
    const addButton = addDialog.getByRole('button', { name: 'Add contributor' });
    await expect(addButton).toBeEnabled();
    await addButton.click();
    await expect(page).toHaveURL(/\/contributors\/[^/]+$/);
    const id = new URL(page.url()).pathname.split('/').pop()!;

    await page.getByRole('button', { name: 'Edit contributor' }).click();
    const editDialog = page.getByRole('dialog');
    await editDialog.getByLabel('City').fill('Barrie');
    await editDialog.getByLabel('Reason (required)').fill(`Row19x edit ${sfx}`);
    const saveButton = editDialog.getByRole('button', { name: 'Save changes' });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(page.getByText('Address: 10 Elm St, Barrie ON M5V 2T6, CA')).toBeVisible();

    // 2. Sign in as sysadmin (admin@ cannot see the Change log), go to /admin/change-log,
    //    filter by the contributor id, and export the CSV
    await switchUser(page, 'sysadmin');
    await page.goto('/admin/change-log');
    await page.getByLabel('Subject id').fill(id);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV (for EO)' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('change-log-export.csv');

    // 3. Read the downloaded text
    const text = await readFile((await download.path())!, 'utf8');
    // the export starts with a byte-order mark, quotes every field, and ends lines with CRLF
    const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    const header = lines[0]!.replace(/"/g, '').split(',');
    expect(header).toEqual(['at', 'subjectType', 'subjectId', 'actor', 'reason', 'correlationId', 'before', 'after']);

    const dataRows = lines.slice(1);
    expect(dataRows).toHaveLength(2);
    for (const row of dataRows) {
      expect(row).toContain('"Contact"');
      expect(row).toContain(`"${id}"`);
      expect(row).toContain('"Receipt Administrator"');
    }
    const editRow = dataRows.find((r) => r.includes(`Row19x edit ${sfx}`));
    const createRow = dataRows.find((r) => r.includes(`Row19x create ${sfx}`));
    expect(editRow).toBeDefined();
    expect(createRow).toBeDefined();
    // The create row's before field is empty (the column between correlationId and after).
    expect(createRow).toMatch(/"Row19x create [^"]+","[^"]+","","\{/);
  });
});
