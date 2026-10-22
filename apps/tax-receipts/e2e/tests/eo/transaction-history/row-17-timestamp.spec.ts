// spec: specs/eo-transaction-history.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Transaction History', () => {
  test('Row 17: Date and time of the change are captured', async ({ page }) => {
    const sfx = Date.now().toString(36);
    const lastName = `Stamp${sfx}`;
    const createReason = `Row17 create ${sfx}`;
    const editReason = `Row17 time ${sfx}`;

    // 1. Sign in as admin, add the contributor, then edit its street number to '22'
    await signIn(page, 'admin');
    await page.goto('/contributors');
    await page.getByRole('button', { name: 'Add a contributor' }).click();
    const addDialog = page.getByRole('dialog');
    await addDialog.getByLabel('First name').fill('Tim');
    await addDialog.getByLabel('Last name').fill(lastName);
    await addDialog.getByLabel('Street number').fill('10');
    await addDialog.getByLabel('Street', { exact: true }).fill('Elm St');
    await addDialog.getByLabel('City').fill('Toronto');
    await addDialog.getByLabel('Postal code').fill('M5V 2T6');
    await addDialog.getByLabel('Reason (required)').fill(createReason);
    const addButton = addDialog.getByRole('button', { name: 'Add contributor' });
    await expect(addButton).toBeEnabled();
    await addButton.click();
    await expect(page).toHaveURL(/\/contributors\/[^/]+$/);
    await expect(page.getByText('Address: 10 Elm St, Toronto ON M5V 2T6, CA')).toBeVisible();
    const id = new URL(page.url()).pathname.split('/').pop()!;

    await page.getByRole('button', { name: 'Edit contributor' }).click();
    const editDialog = page.getByRole('dialog');
    await editDialog.getByLabel('Street number').fill('22');
    await editDialog.getByLabel('Reason (required)').fill(editReason);
    const saveButton = editDialog.getByRole('button', { name: 'Save changes' });
    await expect(saveButton).toBeEnabled();
    const t0 = new Date();
    await saveButton.click();
    await expect(editDialog).toBeHidden();
    const t1 = new Date();
    await expect(page.getByText('Address: 22 Elm St, Toronto ON M5V 2T6, CA')).toBeVisible();

    // 2. Go to /admin/change-log, filter 'Subject id' = <id>
    await page.goto('/admin/change-log');
    await page.getByLabel('Subject id').fill(id);
    const editRow = page.getByRole('row').filter({ hasText: editReason });
    const createRow = page.getByRole('row').filter({ hasText: createReason });
    await expect(editRow).toBeVisible();
    await expect(createRow).toBeVisible();
    const atText = (await editRow.getByRole('cell').first().innerText()).trim();
    // Localized date and time, for example '10/18/2026, 1:53:05 PM'
    expect(atText).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2}\s?[AP]M/);
    const shownAt = new Date(atText);
    expect(Math.abs(shownAt.getTime() - t0.getTime())).toBeLessThan(60_000);
    expect(shownAt.toLocaleDateString('en-US')).toBe(t0.toLocaleDateString('en-US'));

    // 3. Read GET /api/change-log?subjectId=<id> and parse entry.at for each entry
    const res = await page.request.get(`/api/change-log?subjectId=${id}`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { data: { reason: string; at: string }[] };
    const editEntry = body.data.find((e) => e.reason === editReason)!;
    const createEntry = body.data.find((e) => e.reason === createReason)!;
    expect(editEntry).toBeDefined();
    expect(createEntry).toBeDefined();
    expect(editEntry.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    const editAt = new Date(editEntry.at).getTime();
    expect(editAt).toBeGreaterThanOrEqual(t0.getTime() - 5000);
    expect(editAt).toBeLessThanOrEqual(t1.getTime() + 5000);
    expect(new Date(createEntry.at).getTime()).toBeLessThan(editAt);
    // The table lists newest first
    const rows = page.getByRole('row').filter({ hasText: 'Row17 ' });
    await expect(rows.first()).toContainText(editReason);

    // 4. Date filters: From = today, From = tomorrow, To = yesterday
    // Days are taken from the entry's own UTC date so a run near midnight UTC stays consistent.
    const dayMs = 24 * 60 * 60 * 1000;
    const today = editEntry.at.slice(0, 10);
    const tomorrow = new Date(Date.parse(today) + dayMs).toISOString().slice(0, 10);
    const yesterday = new Date(Date.parse(today) - dayMs).toISOString().slice(0, 10);
    const from = page.getByLabel('From');
    const to = page.getByLabel('To', { exact: true });

    await from.fill(today);
    await expect(editRow).toBeVisible();
    await expect(createRow).toBeVisible();

    await from.fill(tomorrow);
    await expect(page.getByText('No change-log entries match these filters.')).toBeVisible();
    await expect(editRow).toBeHidden();
    await expect(createRow).toBeHidden();

    await from.fill('');
    await to.fill(yesterday);
    await expect(page.getByText('No change-log entries match these filters.')).toBeVisible();
    await expect(editRow).toBeHidden();
    await expect(createRow).toBeHidden();
  });
});
