// spec: specs/eo-transaction-history.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn, switchUser } from '../../helpers.js';

test.describe('Transaction History', () => {
  test('Row 13: Two edits produce two distinct audit entries and a correlation id narrows to one cascade', async ({ page }) => {
    const sfx = Date.now().toString(36);
    const lastName = `Trail${sfx}`;
    const createReason = `Row13 create ${sfx}`;
    const editReason = `Row13 edit ${sfx}`;

    await signIn(page, 'admin');

    // 1. Create contributor 'Audrey Trail<suffix>' with a full address
    await page.goto('/contributors');
    await page.getByRole('button', { name: 'Add a contributor' }).click();
    const addDialog = page.getByRole('dialog');
    await addDialog.getByLabel('First name').fill('Audrey');
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
    await expect(page.getByRole('heading', { name: `Audrey ${lastName}` })).toBeVisible();
    await expect(page.getByText('Address: 10 Elm St, Toronto ON M5V 2T6, CA')).toBeVisible();
    const id = new URL(page.url()).pathname.split('/').pop()!;

    // 2. Edit the street to 'Oak Ave'
    await page.getByRole('button', { name: 'Edit contributor' }).click();
    const editDialog = page.getByRole('dialog');
    await editDialog.getByLabel('Street', { exact: true }).fill('Oak Ave');
    await editDialog.getByLabel('Reason (required)').fill(editReason);
    const saveButton = editDialog.getByRole('button', { name: 'Save changes' });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByText('Address: 10 Oak Ave, Toronto ON M5V 2T6, CA')).toBeVisible();

    // 3. Sign in as sysadmin (admin@ cannot see the Change log), go to /admin/change-log, and filter by the contributor id
    await switchUser(page, 'sysadmin');
    await page.goto('/admin/change-log');
    await page.getByLabel('Subject id').fill(id);
    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText(`Contact (${id})`);
    await expect(rows.nth(0)).toContainText(editReason);
    await expect(rows.nth(1)).toContainText(`Contact (${id})`);
    await expect(rows.nth(1)).toContainText(createReason);

    // 4. Read the entries from the API
    const response = await page.request.get(`/api/change-log?subjectId=${id}`);
    expect(response.ok()).toBeTruthy();
    const { data } = (await response.json()) as {
      data: { id: string; correlationId: string; reason: string }[];
    };
    expect(data).toHaveLength(2);
    const [first, second] = data as [(typeof data)[number], (typeof data)[number]];
    expect(first.id).toBeTruthy();
    expect(second.id).toBeTruthy();
    expect(first.id).not.toBe(second.id);
    expect(first.correlationId).toBeTruthy();
    expect(second.correlationId).toBeTruthy();
    expect(first.correlationId).not.toBe(second.correlationId);
    const newer = data.find((e) => e.reason === editReason)!;
    expect(newer).toBeDefined();

    // 5. Narrow to the newer entry by its correlation id
    await page.getByLabel('Correlation id').fill(newer.correlationId);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(editReason);
    await expect(page.getByText(createReason)).toBeHidden();
  });
});
