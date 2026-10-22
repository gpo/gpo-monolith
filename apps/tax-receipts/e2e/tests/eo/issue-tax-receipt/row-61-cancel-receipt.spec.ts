// spec: specs/eo-issue-tax-receipt.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { signIn } from '../../helpers.js';
import { addContributor, addPayment, createPeriod, issueSpace, newSuffix, signOut } from './recipe.js';

test.describe('Issue Tax Receipt: corrections', () => {
  test('Row 61: A receipt can be cancelled and keeps its number', async ({ page }) => {
    const sfx = newSuffix();

    // 1. Recipe R1 to R4 with one $50 payment. Open the contribution page; note the receipt number
    //    and that 'Left to receipt' for the contributor is $0.00.
    await signIn(page, 'sysadmin');
    const periodId = await createPeriod(page, sfx);
    await signOut(page);

    await signIn(page, 'admin');
    const donor = await addContributor(page, sfx);
    await addPayment(page, { donorName: donor.name, periodName: `E2E ${sfx}`, amount: 50, receivedOn: '2024-01-10' });
    await signOut(page);

    await signIn(page, 'cfo');
    const { receiptNumbers } = await issueSpace(page, periodId, { reason: `E2E issue ${sfx}` });
    expect(receiptNumbers).toHaveLength(1);
    const receiptNumber = receiptNumbers[0]!;
    const resultRow = page.getByRole('row').filter({ hasText: receiptNumber });
    const receiptHref = (await resultRow.getByRole('link', { name: 'View PDF' }).getAttribute('href'))!;
    const receiptId = receiptHref.match(/^\/api\/receipts\/([^/]+)\/pdf$/)![1]!;
    await resultRow.getByRole('link', { name: /^c[a-z0-9]{20,}$/ }).click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);

    const receiptRow = page.getByRole('row').filter({ hasText: receiptNumber });
    await expect(receiptRow).toContainText('ISSUED');
    const issueButton = page.getByRole('button', { name: 'Issue a receipt' });
    await expect(issueButton).toBeDisabled();

    // 2. Open the receipt's 'Correct' menu, choose 'Cancel this receipt'.
    const correct = page.getByRole('button', { name: `Correct receipt ${receiptNumber}` });
    await correct.click();
    await page.getByRole('menuitem', { name: 'Cancel this receipt' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: `Cancel this receipt: ${receiptNumber}` })).toBeVisible();
    await expect(dialog).toContainText('its number is kept');
    await expect(dialog).toContainText('a watermarked cancellation notice is stored');
    const confirm = dialog.getByRole('button', { name: 'Confirm' });
    await expect(confirm).toBeDisabled();

    // 3. Fill reason 'E2E cancel' and click Confirm. Close the modal if it stays open.
    await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill(`E2E cancel ${sfx}`);
    await expect(confirm).toBeEnabled();
    await confirm.click();
    // live, the modal closes itself after a successful cancel
    await expect(dialog).toBeHidden();
    await expect(receiptRow).toContainText('CANCELLED');
    await expect(receiptRow).toContainText(receiptNumber);
    await expect(page.getByRole('button', { name: `Correct receipt ${receiptNumber}` })).toHaveCount(0);
    await expect(issueButton).toBeEnabled();
    await signOut(page);

    // 4. As sysadmin check /admin/change-log for the receipt id.
    await signIn(page, 'sysadmin');
    await page.goto('/admin/change-log');
    await page.getByLabel('Subject type').selectOption('Receipt');
    await page.getByRole('textbox', { name: 'Subject id' }).fill(receiptId);
    const cancelEntry = page
      .getByRole('row')
      .filter({ hasText: `E2E cancel ${sfx}` })
      .filter({ hasText: '{"status":"ISSUED"}' });
    await expect(cancelEntry).toHaveCount(1);
    await expect(cancelEntry).toContainText('{"status":"CANCELLED"}');
  });
});
