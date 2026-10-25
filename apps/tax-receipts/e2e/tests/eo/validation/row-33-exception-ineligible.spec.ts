// spec: specs/eo-validation.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Validation and Controls', () => {
  test('Row 33: Resolve an ineligible contributor as EXCEPTION with a reason', async ({ page }) => {
    const sfx = Date.now().toString(36);
    const lastName = `Except${sfx}`;
    const donor = `Ineligible ${lastName}`;

    // 1. Sign in as admin.
    await signIn(page, 'admin');

    // 2. Create the contributor (BC address) and a $50.00 payment in period 64 dated 2025-03-15.
    await page.goto('/payments/new');
    await page.getByRole('button', { name: 'Not on file? Add a new contributor' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'First name' }).fill('Ineligible');
    await dialog.getByRole('textbox', { name: 'Last name' }).fill(lastName);
    await dialog.getByRole('textbox', { name: 'Street number' }).fill('456');
    await dialog.getByRole('textbox', { name: 'Street', exact: true }).fill('Robson St');
    await dialog.getByRole('textbox', { name: 'City' }).fill('Vancouver');
    await dialog.getByLabel('Province').selectOption('BC');
    await dialog.getByRole('textbox', { name: 'Postal code' }).fill('V6B 1A1');
    await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill(`e2e b1 exception ${sfx}`);
    const addContributor = dialog.getByRole('button', { name: 'Add contributor' });
    await expect(addContributor).toBeEnabled();
    await addContributor.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Donor who paid' })).toHaveValue(donor);

    await page.getByRole('textbox', { name: 'Amount ($)' }).first().fill('50');
    await page.getByRole('textbox', { name: 'Received on' }).fill('2025-03-15');
    await page.getByRole('textbox', { name: 'Reason (required)' }).fill(`e2e b1 exception ${sfx}`);
    const savePayment = page.getByRole('button', { name: 'Save payment' });
    await expect(savePayment).toBeEnabled();
    await savePayment.click();
    await page.getByRole('link', { name: 'Open the contribution' }).click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    await expect(page.getByRole('cell', { name: /Donor's address is out of province/ })).toBeVisible();

    // 3. Go to /work-queue and click Exception on the B1 row for the donor.
    await page.goto('/work-queue');
    const b1Row = page.getByRole('row').filter({ hasText: lastName }).filter({ hasText: '(B1)' });
    const c3Row = page.getByRole('row').filter({ hasText: lastName }).filter({ hasText: '(C3)' });
    await expect(b1Row.getByRole('cell', { name: 'OPEN' })).toBeVisible();
    const exceptionButton = b1Row.getByRole('button', { name: 'Exception' });
    await expect(exceptionButton).toBeEnabled();
    await exceptionButton.click();
    const modal = page.getByRole('dialog', { name: 'Record an exception' });
    const reasonBox = modal.getByRole('textbox', { name: 'Exception reason' });
    const record = modal.getByRole('button', { name: 'Record exception' });
    await expect(reasonBox).toBeVisible();
    await expect(record).toBeDisabled();
    await expect(modal.getByRole('button', { name: 'Cancel' })).toBeVisible();

    // 4. Type 'ab' into 'Exception reason'.
    await reasonBox.fill('ab');
    await expect(record).toBeDisabled();

    // 5. Replace with a full reason and record it.
    const reason = 'Ontario resident studying at UBC';
    await reasonBox.fill(reason);
    await expect(record).toBeEnabled();
    await record.click();
    await expect(modal).toBeHidden();
    await expect(b1Row.getByRole('cell', { name: 'EXCEPTION' })).toBeVisible();
    await expect(b1Row.getByText(reason)).toBeVisible();
    await expect(c3Row.getByRole('cell', { name: 'OPEN' })).toBeVisible();

    // 6. Edit the exception to explain how residency was confirmed.
    await b1Row.getByRole('button', { name: 'Edit' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit exception' });
    const editBox = edit.getByRole('textbox', { name: 'Exception reason' });
    await expect(editBox).toHaveValue(reason);
    const longer = 'Ontario resident studying at UBC; home address in Ottawa confirmed with the donor by phone';
    await editBox.fill(longer);
    const save = edit.getByRole('button', { name: 'Save exception' });
    await expect(save).toBeDisabled();
    await edit.getByRole('textbox', { name: 'Reason for the edit (required)' }).fill('added how residency was confirmed');
    await expect(save).toBeEnabled();
    await save.click();
    await expect(edit).toBeHidden();
    await expect(b1Row.getByRole('cell', { name: 'EXCEPTION' })).toBeVisible();
    await expect(b1Row.getByText(longer)).toBeVisible();
  });
});
