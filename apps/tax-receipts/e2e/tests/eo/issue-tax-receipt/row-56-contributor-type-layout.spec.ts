// spec: specs/eo-issue-tax-receipt.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { pdfTextFromBuffer, signIn } from '../../helpers.js';
import { addContributor, addPayment, createPeriod, issueSpace, newSuffix, signOut } from './recipe.js';

test.describe('Issue Tax Receipt: issuance and receipt contents', () => {
  test("Row 56: Contributor type on the receipt under the 'With contributor type' layout, then switch back to Original", async ({
    page,
  }) => {
    const sfx = newSuffix();
    const switchReason = `E2E contributor type ${sfx}`;
    const restoreReason = `E2E restore layout ${sfx}`;
    const reasonField = () => page.getByRole('textbox', { name: 'Reason (required to change the layout)' });
    const original = () => page.getByRole('radio', { name: 'Original' });
    const withType = () => page.getByRole('radio', { name: 'With contributor type' });

    // 1. Prepare own data first (Recipe R1 to R3, one $50 payment) so the layout stays switched for the
    //    shortest time. Sign in as sysadmin and open /admin/receipts ('Receipt layout').
    await signIn(page, 'sysadmin');
    const periodId = await createPeriod(page, sfx);
    await signOut(page);

    await signIn(page, 'admin');
    const donor = await addContributor(page, sfx);
    await addPayment(page, {
      donorName: donor.name,
      periodName: `E2E ${sfx}`,
      amount: 50,
      receivedOn: '2024-01-10',
    });
    await signOut(page);

    await signIn(page, 'sysadmin');
    await page.goto('/admin/receipts');
    await expect(page.getByText('Receipt layout')).toBeVisible();
    await expect(original()).toBeChecked();
    await expect(original()).toBeDisabled();
    await expect(withType()).toBeDisabled();

    try {
      // 2. Fill 'Reason (required to change the layout)'. Choose 'With contributor type'.
      await reasonField().fill(switchReason);
      await expect(withType()).toBeEnabled();
      // choosing saves, and the radio reflects the saved value once the
      // settings refetch, so click and let toBeChecked retry (check() does not)
      await withType().click();
      await expect(withType()).toBeChecked();
      await expect(reasonField()).toHaveValue('');

      // 3. Sign out, sign in as cfo, issue the own space (R4). Fetch the PDF.
      await signOut(page);
      await signIn(page, 'cfo');
      await issueSpace(page, periodId, { reason: `E2E issue ${sfx}` });
      const resultRow = page.getByRole('row').filter({ has: page.getByText(/^GPO-00\d{6}$/) });
      await expect(resultRow).toHaveCount(1);
      const href = (await resultRow.getByRole('link', { name: 'View PDF' }).getAttribute('href'))!;
      expect(href).toMatch(/^\/api\/receipts\/[^/]+\/pdf$/);
      const response = await page.request.get(href);
      expect(response.status()).toBe(200);
      const text = await pdfTextFromBuffer(await response.body());
      expect(text).toContain('Contributor Type: Individual');
      expect(text).toContain('Contribution Type: Monetary');
    } finally {
      // 4. Finally block: sign in as sysadmin, open /admin/receipts, fill a new reason, choose 'Original'.
      await page.context().clearCookies();
      await signIn(page, 'sysadmin');
      await page.goto('/admin/receipts');
      await expect(page.getByText('Receipt layout')).toBeVisible();
      if (!(await original().isChecked())) {
        await reasonField().fill(restoreReason);
        await expect(original()).toBeEnabled();
        await original().click();
      }
      await expect(original()).toBeChecked();
    }

    // 5. Open /admin/change-log (Change-log explorer), set Subject type to ReceiptSettings.
    await page.goto('/admin/change-log');
    await page.getByLabel('Subject type').selectOption('ReceiptSettings');
    // Other runs add entries too, so find this run's two entries by their unique reasons.
    const restoreRow = page.getByRole('row').filter({ hasText: restoreReason });
    const switchRow = page.getByRole('row').filter({ hasText: switchReason });
    await expect(restoreRow).toHaveCount(1);
    await expect(switchRow).toHaveCount(1);
    await expect(restoreRow).toContainText('Sys Admin');
    await expect(switchRow).toContainText('Sys Admin');
    // Newest first: the switch back appears above the switch to the contributor-type layout.
    const allRows = await page.getByRole('row').allTextContents();
    const restoreIdx = allRows.findIndex((r) => r.includes(restoreReason));
    const switchIdx = allRows.findIndex((r) => r.includes(switchReason));
    expect(restoreIdx).toBeGreaterThan(0);
    expect(restoreIdx).toBeLessThan(switchIdx);

    // 6. Optional regression (issuing a second receipt after the switch-back) is not covered: it needs a
    //    second payment and the Original layout is already confirmed selected above.
  });
});
