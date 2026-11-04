// spec: specs/eo-validation.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Validation and Controls', () => {
  test('Row 38: Blocked Blake is over the CA limit (B2) and the whole of Space B is blocked from issuance', async ({
    page,
  }) => {
    // 1. Sign in as cfo.
    await signIn(page, 'cfo');

    // 2. Go to /work-queue and find the row for 'Blocked Blake' with Rule code (B2).
    await page.goto('/work-queue');
    const b2Row = page
      .getByRole('row')
      .filter({ hasText: 'Blocked Blake' })
      .filter({ hasText: '(B2)' });
    await expect(b2Row).toContainText('Donor is over a contribution limit');
    await expect(b2Row).toContainText('OPEN');

    // 3. Open that row's Contribution link.
    await b2Row.getByRole('link', { name: 'Contribution' }).click();
    await expect(page).toHaveURL(/\/contributions\/.+/);
    await expect(page.getByText('$3500.00').first()).toBeVisible();
    await expect(page.getByText('Constituency association, riding 121')).toBeVisible();
    await expect(page.getByText('2026 Annual')).toBeVisible();
    const workItemB2 = page
      .getByRole('row')
      .filter({ hasText: 'Donor is over a contribution limit (B2)' });
    await expect(workItemB2).toContainText('OPEN');

    // 4. Click 'Correct', choose Action 'Reallocate to another entity (over-limit)' and
    //    click 'Show over-limit proposal'. Do not commit; close the dialog with Escape.
    await page.getByRole('button', { name: 'Correct', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Action').selectOption('Reallocate to another entity (over-limit)');
    await dialog.getByRole('button', { name: 'Show over-limit proposal' }).click();
    await expect(dialog.getByText('Over the CA limit by $75.00 ($3500.00 against $3425.00).')).toBeVisible();
    // The plan expected "PARTY"; the live app prints "Party (province-wide)".
    await expect(
      dialog.getByText('Move $75.00 to Party (province-wide); room for $5000.00.'),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Use this' }).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // 5. Go to /spaces/67/CA/issue?ridingNumber=121.
    await page.goto('/spaces/67/CA/issue?ridingNumber=121');
    await expect(page.getByRole('heading', { name: 'Issue receipts' })).toBeVisible();
    await expect(page.getByText('Period 67 · Riding 121 · Constituency association')).toBeVisible();
    await expect(page.getByText(/open work item\(s\) block issuance for this space/)).toBeVisible();
    const blakeB2 = page
      .getByRole('row')
      .filter({ hasText: 'Blocked Blake' })
      .filter({ hasText: 'Donor is over a contribution limit (B2)' });
    await expect(blakeB2).toBeVisible();
    // A different donor is listed too: the whole space is blocked.
    await expect(page.getByRole('row').filter({ hasText: 'Clean Casey' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next: generate' })).toBeDisabled();
  });
});
