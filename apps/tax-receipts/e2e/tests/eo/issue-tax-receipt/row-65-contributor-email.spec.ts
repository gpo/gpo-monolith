// spec: specs/eo-issue-tax-receipt.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';
import { addContributor, newSuffix } from './recipe.js';

test.describe('Issue Tax Receipt: delivery', () => {
  test('Row 65: Contributor email is held on the contributor record and is editable when tool-owned', async ({ page }) => {
    const sfx = newSuffix();

    // 1. Read-only: sign in as admin, open /contributors and find Email Emma. Open her record.
    await signIn(page, 'admin');
    await page.goto('/contributors');
    const emmaRow = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Email Emma' }) });
    await expect(emmaRow.getByRole('cell', { name: 'email.emma@g4.fixture.test' })).toBeVisible();
    await expect(emmaRow.getByRole('cell', { name: 'This tool' })).toBeVisible();
    await page.getByRole('link', { name: 'Email Emma' }).click();
    await expect(page.getByText('Email: email.emma@g4.fixture.test')).toBeVisible();
    await expect(page.getByText('Qomon contact: none (kept in this tool)')).toBeVisible();

    // 2. Click 'Edit contributor', read the Email field, then click Cancel. Do NOT save.
    await page.getByRole('button', { name: 'Edit contributor' }).click();
    const emmaDialog = page.getByRole('dialog');
    const emmaEmail = emmaDialog.getByLabel('Email');
    await expect(emmaEmail).toHaveValue('email.emma@g4.fixture.test');
    await expect(emmaEmail).toBeEnabled();
    await expect(emmaEmail).toBeEditable();
    await expect(emmaDialog.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await emmaDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(emmaDialog).toBeHidden();
    await expect(page.getByText('Email: email.emma@g4.fixture.test')).toBeVisible();

    // 3. Own data. Recipe R2, open 'Edit contributor', change Email, Reason, 'Save changes'.
    const { id, name } = await addContributor(page, sfx);
    const newEmail = `iris.${sfx}.new@e2e.test`;
    await page.getByRole('button', { name: 'Edit contributor' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Email')).toHaveValue(`iris.${sfx}@e2e.test`);
    await dialog.getByLabel('Email').fill(newEmail);
    await dialog.getByLabel('Reason (required)').fill(`E2E email change ${sfx}`);
    const save = dialog.getByRole('button', { name: 'Save changes' });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(`Email: ${newEmail}`)).toBeVisible();
    // creation entry plus the email edit
    await expect(page.getByRole('button', { name: 'Show 2 changes' })).toBeVisible();

    await page.goto('/contributors');
    await page.getByRole('textbox', { name: 'Search' }).fill(name.split(' ').pop()!);
    const row = page.getByRole('row').filter({ has: page.getByRole('link', { name }) });
    await expect(row.getByRole('cell', { name: newEmail })).toBeVisible();
    expect(id).toBeTruthy();
  });
});
