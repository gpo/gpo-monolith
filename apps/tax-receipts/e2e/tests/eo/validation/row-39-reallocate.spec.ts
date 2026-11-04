// spec: specs/eo-validation.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Validation and Controls', () => {
  test('Row 39: Reallocate an over-limit contribution from the over-limit proposal (cfo)', async ({ page }) => {
    const sfx = Date.now().toString(36);
    const lastName = `Realloc${sfx}`;
    const donor = `Limit ${lastName}`;

    // 1. Sign in as admin to create the data.
    await signIn(page, 'admin');

    // 2. At /payments/new add the contributor and the $6000 payment, then open the contribution.
    await page.goto('/payments/new');
    await page.getByRole('button', { name: 'Not on file? Add a new contributor' }).click();
    const addDialog = page.getByRole('dialog');
    await addDialog.getByRole('textbox', { name: 'First name' }).fill('Limit');
    await addDialog.getByRole('textbox', { name: 'Last name' }).fill(lastName);
    await addDialog.getByRole('textbox', { name: 'Street number' }).fill('13');
    await addDialog.getByRole('textbox', { name: 'Street', exact: true }).fill('Queen St');
    await addDialog.getByRole('textbox', { name: 'City' }).fill('Toronto');
    await addDialog.getByRole('textbox', { name: 'Postal code' }).fill('M5V 2T6');
    await addDialog.getByRole('textbox', { name: 'Reason (required)' }).fill(`e2e b2 ${sfx}`);
    await addDialog.getByRole('button', { name: 'Add contributor' }).click();
    await expect(addDialog).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Donor who paid' })).toHaveValue(donor);

    await page.getByRole('textbox', { name: 'Amount ($)' }).first().fill('6000');
    await page.getByRole('textbox', { name: 'Received on' }).fill('2026-06-01');
    await page.getByLabel('Period').selectOption('2025 General Election');
    await page.getByRole('textbox', { name: 'Reason (required)' }).fill(`e2e b2 ${sfx}`);
    await page.getByRole('button', { name: 'Save payment' }).click();
    await page.getByRole('link', { name: 'Open the contribution' }).click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    const contributionUrl = page.url();
    await expect(page.getByRole('row').filter({ hasText: 'Donor is over a contribution limit' })).toContainText('OPEN');

    // 3. Verify the admin role has no Reallocate.
    await page.getByRole('button', { name: 'Correct' }).click();
    const adminDialog = page.getByRole('dialog');
    const action = adminDialog.getByRole('combobox', { name: 'Action' });
    await expect(action.getByRole('option', { name: 'Correct the amount' })).toBeAttached();
    await expect(action.getByRole('option', { name: 'Refund' })).toBeAttached();
    await expect(action.getByRole('option', { name: /Reallocate/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(adminDialog).toBeHidden();

    // 4. Sign out and sign in as cfo; open the same contribution and choose Reallocate.
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await signIn(page, 'cfo');
    await page.goto(contributionUrl);
    await page.getByRole('button', { name: 'Correct' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Action' }).selectOption('Reallocate to another entity (over-limit)');
    await expect(dialog.getByRole('textbox', { name: 'Part 1 amount ($)' })).toHaveValue('6000');
    await expect(dialog.getByRole('combobox', { name: 'Entity' })).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Riding' })).toBeVisible();
    await expect(dialog.getByText('Parts total $6000.00 of $6000.00')).toBeVisible();

    // 5. Click 'Show over-limit proposal'.
    await dialog.getByRole('button', { name: 'Show over-limit proposal' }).click();
    await expect(dialog.getByText('Over the PARTY limit by $1000.00 ($6000.00 against $5000.00).')).toBeVisible();
    await expect(dialog.getByText(/Move \$1000\.00 to CA .*; room for \$3425\.00\./)).toBeVisible();
    await expect(dialog.getByText(/Move \$1000\.00 to CAMPAIGN .*; room for \$3425\.00\./)).toBeVisible();

    // 6. Use this on the CA option, set Part 2 riding to 121, fill Reason.
    await dialog.getByRole('button', { name: 'Use this' }).first().click();
    await expect(dialog.getByRole('textbox', { name: 'Part 1 amount ($)' })).toHaveValue('5000');
    await expect(dialog.getByRole('textbox', { name: 'Part 2 amount ($)' })).toHaveValue('1000');
    await dialog.getByRole('textbox', { name: 'Riding' }).last().fill('121');
    await page.getByRole('option', { name: /121/ }).click();
    await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill(`e2e reallocate overage ${sfx}`);
    await expect(dialog.getByText('Parts total $6000.00 of $6000.00')).toBeVisible();

    // 7. Click 'Preview cascade'.
    await dialog.getByRole('button', { name: 'Preview cascade' }).click();
    await expect(dialog.getByText(`${donor}, $5000.00, Party (province-wide)`)).toBeVisible();
    await expect(dialog.getByText(`${donor}, $1000.00, CA 121`)).toBeVisible();
    await expect(dialog.getByText('None affected: nothing had been receipted.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Commit correction' })).toBeEnabled();

    // 8. Click 'Commit correction'.
    await dialog.getByRole('button', { name: 'Commit correction' }).click();
    await expect(dialog.getByText('Correction committed')).toBeVisible();
    await expect(dialog.getByText(/2 contributions created/)).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'part 1' })).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'part 2' })).toBeVisible();

    // 9. Close the dialog and check the work queue rows for the donor.
    await page.keyboard.press('Escape');
    await page.goto('/work-queue');
    const originalId = contributionUrl.split('/').pop()!;
    const b2Row = page
      .getByRole('row')
      .filter({ hasText: lastName })
      .filter({ hasText: '(B2)' });
    await expect(b2Row).toHaveCount(1);
    await expect(b2Row).toContainText('RESOLVED');
    await expect(b2Row).toContainText(`closed by a correction: ${originalId} is now SUPERSEDED`);
    const a1Closed = page
      .getByRole('row')
      .filter({ hasText: lastName })
      .filter({ hasText: '(A1)' })
      .filter({ hasText: 'RESOLVED' });
    await expect(a1Closed).toContainText(`closed by a correction: ${originalId} is now SUPERSEDED`);
  });
});
