// spec: specs/eo-transaction-history.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

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

    // 2. Go to /admin/change-log, filter by the contributor id, locate the edit row
    await page.goto('/admin/change-log');
    await page.getByLabel('Subject id').fill(id);
    const row = page.getByRole('row').filter({ hasText: reason });
    await expect(row).toHaveCount(1);
    // Cells: At, Subject, Actor, Reason, Before, After. Before is truncated JSON, not an em dash.
    const beforeCell = row.getByRole('cell').nth(4);
    await expect(beforeCell).toContainText(`{"id":"${id}"`);
    await expect(beforeCell).not.toHaveText('—');

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
    await expect(editRow.getByRole('cell').nth(3)).toContainText('"city":"Toronto"');
    await expect(editRow.getByRole('cell').nth(4)).toContainText('"city":"Hamilton"');
    const createRow = page.getByRole('row').filter({ hasText: `Row15 create ${sfx}` });
    await expect(createRow).toHaveCount(1);
    await expect(createRow.getByRole('cell').nth(3)).toHaveText('—');
  });
});
