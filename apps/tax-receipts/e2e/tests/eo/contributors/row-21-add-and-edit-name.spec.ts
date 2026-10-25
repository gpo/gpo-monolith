// spec: specs/eo-contributors.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Contributors', () => {
  test('Row 21: Add a contributor from the Contributors page with first and last name recorded separately, then edit the name with a reason', async ({ page }) => {
    const sfx = Date.now().toString(36);
    const lastName = `Lovelace-${sfx}`;
    const email = `ada.${sfx}@example.test`;

    // 1. Sign in as admin, go to /contributors, click 'Add a contributor'.
    await signIn(page, 'admin');
    await page.goto('/contributors');
    await page.getByRole('button', { name: 'Add a contributor' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Add a contributor' })).toBeVisible();
    const addButton = dialog.getByRole('button', { name: 'Add contributor' });
    await expect(addButton).toBeDisabled();

    // 2. Negative: fill only First name and Reason.
    await dialog.getByRole('textbox', { name: 'First name' }).fill('Ada');
    await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill('New donor added at event');
    await expect(addButton).toBeDisabled();

    // 3. Add Last name, then clear the Reason.
    await dialog.getByRole('textbox', { name: 'Last name' }).fill(lastName);
    await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill('');
    await expect(addButton).toBeDisabled();

    // 4. Negative: clear First name (Last name filled, Reason restored).
    await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill('New donor added at event');
    await dialog.getByRole('textbox', { name: 'First name' }).fill('');
    await expect(addButton).toBeDisabled();

    // 5. Fill everything and add.
    await dialog.getByRole('textbox', { name: 'First name' }).fill('Ada');
    await dialog.getByRole('textbox', { name: 'Email' }).fill(email);
    await expect(addButton).toBeEnabled();
    await addButton.click();
    await expect(page).toHaveURL(/\/contributors\/[^/]+$/);
    await expect(page.getByRole('heading', { name: `Ada ${lastName}` })).toBeVisible();
    await expect(page.getByText('First name: Ada', { exact: true })).toBeVisible();
    await expect(page.getByText(`Last name: ${lastName}`, { exact: true })).toBeVisible();
    await expect(page.getByText('This tool', { exact: true })).toBeVisible();
    await expect(page.getByText(`Email: ${email}`, { exact: true })).toBeVisible();

    // 6. Click 'Edit contributor', change First name; Save is disabled without a reason.
    await page.getByRole('button', { name: 'Edit contributor' }).click();
    const editDialog = page.getByRole('dialog');
    await editDialog.getByRole('textbox', { name: 'First name' }).fill('Augusta');
    const saveButton = editDialog.getByRole('button', { name: 'Save changes' });
    await expect(saveButton).toBeDisabled();

    // 7. Enter the reason, save, and expand the change history.
    await editDialog.getByRole('textbox', { name: 'Reason (required)' }).fill('Corrected first name spelling');
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(page.getByRole('heading', { name: `Augusta ${lastName}` })).toBeVisible();
    await expect(page.getByText('First name: Augusta', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Show 2 changes' }).click();
    await expect(page.getByRole('button', { name: 'Hide' })).toBeVisible();

    const editRow = page.getByRole('row', { name: /Corrected first name spelling/ });
    await expect(editRow).toContainText('Receipt Administrator');
    await expect(editRow.getByRole('cell').nth(3)).toContainText('"firstName":"Ada"');
    await expect(editRow.getByRole('cell').nth(4)).toContainText('"firstName":"Augusta"');

    const createRow = page.getByRole('row', { name: /New donor added at event/ });
    await expect(createRow).toContainText('Receipt Administrator');
    await expect(createRow.getByRole('cell').nth(3)).toHaveText('—');

    // 8. Go to /contributors and search by the suffix (live filter, no submit needed).
    await page.goto('/contributors');
    await page.getByRole('textbox', { name: 'Search' }).fill(sfx);
    const rows = page.getByRole('row').filter({ hasText: sfx });
    await expect(rows).toHaveCount(1);
    await expect(rows.getByRole('link', { name: `Augusta ${lastName}` })).toBeVisible();
    await expect(rows).toContainText('This tool');
  });
});
