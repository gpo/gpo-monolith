// spec: specs/eo-contributors.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Contributors', () => {
  test('Row 23: Contributor type is Individual and read-only everywhere it appears', async ({ page }) => {
    const sfx = Date.now().toString(36);
    const lastName = `Individual-${sfx}`;
    const fullName = `Tess ${lastName}`;
    const ontarioNote = 'Ontario accepts political contributions from individuals only.';

    // 1. Sign in as admin, go to /contributors, click 'Add a contributor'.
    await signIn(page, 'admin');
    await page.goto('/contributors');
    await page.getByRole('button', { name: 'Add a contributor' }).click();
    const addDialog = page.getByRole('dialog');
    const typeField = addDialog.getByRole('textbox', { name: 'Contributor type' });
    await expect(typeField).toHaveValue('Individual');
    await expect(typeField).toHaveJSProperty('readOnly', true);
    await typeField.click();
    await page.keyboard.press('x');
    await expect(typeField).toHaveValue('Individual');
    await expect(addDialog.getByText(ontarioNote)).toBeVisible();

    // 2. Fill First name, Last name, Reason and click 'Add contributor'.
    await addDialog.getByRole('textbox', { name: 'First name' }).fill('Tess');
    await addDialog.getByRole('textbox', { name: 'Last name' }).fill(lastName);
    await addDialog.getByRole('textbox', { name: 'Reason (required)' }).fill(`E2E row 23 ${sfx}`);
    await addDialog.getByRole('button', { name: 'Add contributor' }).click();
    await expect(page.getByRole('heading', { name: fullName })).toBeVisible();
    await expect(page.getByText('Contributor type: Individual')).toBeVisible();
    const idText = await page.getByText(/^Contributor id: T\d+$/).textContent();
    const contributorId = /T\d+/.exec(idText ?? '')?.[0];
    expect(contributorId).toBeTruthy();

    // 3. Click 'Edit contributor'.
    await page.getByRole('button', { name: 'Edit contributor' }).click();
    const editDialog = page.getByRole('dialog');
    const editTypeField = editDialog.getByRole('textbox', { name: 'Contributor type' });
    await expect(editTypeField).toHaveValue('Individual');
    await expect(editTypeField).toHaveJSProperty('readOnly', true);
    await expect(editDialog.getByText(ontarioNote)).toBeVisible();
    await editDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(editDialog).toBeHidden();

    // 4. Go to /payments/new, pick the donor, record a $20 payment, open the contribution.
    await page.goto('/payments/new');
    await page.getByRole('textbox', { name: 'Donor who paid' }).fill(lastName);
    await page.getByRole('option', { name: fullName }).click();
    await page.getByRole('textbox', { name: 'Amount ($)' }).first().fill('20');
    await page.getByRole('textbox', { name: 'Received on' }).fill('2025-03-15');
    await page.getByLabel('Period').selectOption('2025 General Election');
    await page.getByRole('textbox', { name: 'Reason (required)' }).fill(`E2E row 23 payment ${sfx}`);
    await page.getByRole('button', { name: 'Save payment' }).click();
    await page.getByRole('link', { name: 'Open the contribution' }).click();
    await expect(page.getByText(`Individual, contributor id ${contributorId}`)).toBeVisible();

    // 5. Read-only comparison: Baseline Donor (Qomon-owned) and Email Emma (tool-owned).
    for (const name of ['Baseline Donor', 'Email Emma']) {
      await page.goto('/contributors');
      await page.getByRole('link', { name, exact: true }).click();
      await expect(page.getByRole('heading', { name })).toBeVisible();
      await expect(page.getByText('Contributor type: Individual')).toBeVisible();
    }
  });
});
