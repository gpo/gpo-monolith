// spec: specs/eo-contributors.md
// seed: tests/seed.spec.ts

import { test, expect, type Page } from '@playwright/test';
import { signIn } from '../../helpers.js';

async function addContributor(page: Page, lastName: string, reason: string) {
  await page.goto('/contributors');
  await page.getByRole('button', { name: 'Add a contributor' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'First name' }).fill('Ida');
  await dialog.getByRole('textbox', { name: 'Last name' }).fill(lastName);
  await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill(reason);
  await dialog.getByRole('button', { name: 'Add contributor' }).click();
  await expect(page.getByRole('heading', { name: `Ida ${lastName}` })).toBeVisible();
}

async function readContributorId(page: Page): Promise<string> {
  const text = await page.getByText(/^Contributor id: T\d+$/).textContent();
  const match = /^Contributor id: (T\d+)$/.exec(text ?? '');
  expect(match).not.toBeNull();
  return match![1]!;
}

test.describe('Contributors', () => {
  test('Row 20: Contributor id is system-assigned, differs between two contributors added back to back, and cannot be edited', async ({
    page,
  }) => {
    const sfx = Date.now().toString(36);
    const lastA = `Unique${sfx}A`;
    const lastB = `Unique${sfx}B`;

    // 1. Sign in as admin, go to /contributors, click 'Add a contributor'. The dialog has no Contributor id field and Add contributor is disabled.
    await signIn(page, 'admin');
    await page.goto('/contributors');
    await page.getByRole('button', { name: 'Add a contributor' }).click();
    const addDialog = page.getByRole('dialog');
    await expect(addDialog.getByRole('heading', { name: 'Add a contributor' })).toBeVisible();
    await expect(addDialog.getByLabel('Contributor id')).toHaveCount(0);
    await expect(addDialog.getByRole('button', { name: 'Add contributor' })).toBeDisabled();

    // 2. Fill First name, Last name, and Reason; add the contributor.
    await addDialog.getByRole('textbox', { name: 'First name' }).fill('Ida');
    await addDialog.getByRole('textbox', { name: 'Last name' }).fill(lastA);
    await addDialog.getByRole('textbox', { name: 'Reason (required)' }).fill(`E2E row 20 first contributor ${sfx}`);
    await addDialog.getByRole('button', { name: 'Add contributor' }).click();
    await expect(page).toHaveURL(/\/contributors\/[^/]+$/);
    await expect(page.getByRole('heading', { name: `Ida ${lastA}` })).toBeVisible();
    const idA = await readContributorId(page);
    await expect(page.getByText('Qomon contact: none (kept in this tool)')).toBeVisible();
    await expect(page.getByText(/^Address: none on file/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show 1 change' })).toBeVisible();

    // 3. Go back to /contributors and add a second contributor.
    await addContributor(page, lastB, `E2E row 20 second contributor ${sfx}`);
    const idB = await readContributorId(page);
    expect(idB).not.toBe(idA);

    // 4. On the second record click 'Edit contributor' and inspect the dialog.
    await page.getByRole('button', { name: 'Edit contributor' }).click();
    const editDialog = page.getByRole('dialog');
    await expect(editDialog.getByRole('heading', { name: `Edit Ida ${lastB}` })).toBeVisible();
    for (const label of [
      'First name',
      'Last name',
      'Email',
      'Contributor type',
      'Street number',
      'Street',
      'City',
      'Province',
      'Postal code',
      'Country',
      'Reason (required)',
    ]) {
      // Required fields carry a trailing " *" in their accessible name.
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      await expect(editDialog.getByLabel(new RegExp(`^${escaped}( \\*)?$`))).toBeVisible();
    }
    await expect(editDialog.getByLabel('Contributor id')).toHaveCount(0);
    await expect(editDialog.getByLabel('Qomon contact')).toHaveCount(0);
    await expect(editDialog.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    // 5. Change First name to 'Idabel', enter a reason, and save.
    await editDialog.getByRole('textbox', { name: 'First name' }).fill('Idabel');
    await editDialog.getByRole('textbox', { name: 'Reason (required)' }).fill(`E2E row 20 rename ${sfx}`);
    await expect(editDialog.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    await editDialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('heading', { name: `Idabel ${lastB}` })).toBeVisible();
    await expect(page.getByText(`Contributor id: ${idB}`, { exact: true })).toBeVisible();

    // 6. Click 'Show 2 changes' in Change history; both entries carry the same contributorId.
    await page.getByRole('button', { name: 'Show 2 changes' }).click();
    const renameRow = page.getByRole('row').filter({ hasText: `E2E row 20 rename ${sfx}` });
    const createRow = page.getByRole('row').filter({ hasText: `E2E row 20 second contributor ${sfx}` });
    await expect(renameRow).toContainText(`"contributorId":"${idB}"`);
    await expect(createRow).toContainText(`"contributorId":"${idB}"`);
  });
});
