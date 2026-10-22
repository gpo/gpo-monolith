// spec: specs/eo-issue-tax-receipt.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { signIn } from '../../helpers.js';
import { addContributor, addPayment, createPeriod, issueSpace, newSuffix, signOut } from './recipe.js';

test.describe('Issue Tax Receipt: corrections', () => {
  test('Row 59: A receipt can be set to lost (Lost Lena read-only, plus a live lost reprint)', async ({
    page,
  }) => {
    const sfx = newSuffix();

    // 1. Read-only fixture. As cfo open the contributor 'Lost Lena' (9503 PARTY, $45.00) and her
    //    contribution; take the receipt id from the 'View PDF' href. (Nothing is changed.)
    await signIn(page, 'cfo');
    await page.goto('/contributors');
    await page.getByRole('link', { name: 'Lost Lena' }).click();
    await expect(page.getByRole('heading', { name: 'Lost Lena' })).toBeVisible();
    const lenaRow = page.getByRole('row').filter({ hasText: '$45.00' });
    await expect(lenaRow).toContainText('9503');
    await lenaRow.getByRole('link').click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    const lenaReceiptRow = page.getByRole('row').filter({ hasText: /GPO-00\d{6}/ });
    await expect(lenaReceiptRow).toHaveCount(1);
    // a lost receipt stays valid; this screen shows no separate 'lost' column
    await expect(lenaReceiptRow).toContainText('ISSUED');
    const lenaHref = (await lenaReceiptRow.getByRole('link', { name: 'View PDF' }).getAttribute('href'))!;
    const lenaMatch = lenaHref.match(/^\/api\/receipts\/([^/]+)\/pdf$/);
    expect(lenaMatch).not.toBeNull();
    const lenaReceiptId = lenaMatch![1]!;
    await signOut(page);

    // 2. As sysadmin open /admin/change-log, Subject type Receipt, Subject id <receipt id>.
    await signIn(page, 'sysadmin');
    await page.goto('/admin/change-log');
    await page.getByLabel('Subject type').selectOption('Receipt');
    await page.getByRole('textbox', { name: 'Subject id' }).fill(lenaReceiptId);
    await expect(page.getByRole('row').filter({ hasText: '{"lost":false}' })).toContainText('{"lost":true}');
    // the reprint entry (kind LOST_COPY) is in the After column
    await expect(page.getByRole('row').filter({ hasText: '"kind":"LOST_COPY"' })).toHaveCount(1);
    await signOut(page);

    // 3. Live. Recipe R1 to R4 with one $50 payment (own data). On the contribution page open the
    //    receipt's 'Correct' button and choose 'Reprint as a lost-receipt copy'.
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
    const ownReceiptHref = (await resultRow.getByRole('link', { name: 'View PDF' }).getAttribute('href'))!;
    const ownReceiptId = ownReceiptHref.match(/^\/api\/receipts\/([^/]+)\/pdf$/)![1]!;
    await resultRow.getByRole('link', { name: /^c[a-z0-9]{20,}$/ }).click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);

    const correct = page.getByRole('button', { name: `Correct receipt ${receiptNumber}` });
    await correct.click();
    await page.getByRole('menuitem', { name: 'Reprint as a lost-receipt copy' }).click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: `Reprint as a lost-receipt copy: ${receiptNumber}` }),
    ).toBeVisible();
    await expect(dialog).toContainText('Reprints the receipt unaltered, stamped COPY');
    await expect(dialog).toContainText('The receipt stays valid and is not cancelled.');
    await expect(
      dialog.getByRole('textbox', { name: 'Received-by label (as it prints on the receipt)' }),
    ).toHaveValue('Green Party of Ontario');
    const confirm = dialog.getByRole('button', { name: 'Confirm' });
    await expect(confirm).toBeDisabled();

    // 4. Fill reason 'E2E lost' and click Confirm.
    await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill(`E2E lost ${sfx}`);
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog.getByText('Copy generated; the original is flagged lost.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toBeHidden();
    // the receipt row is still ISSUED and the Cancel / Reissue options remain available
    await expect(page.getByRole('row').filter({ hasText: receiptNumber })).toContainText('ISSUED');
    await correct.click();
    await expect(page.getByRole('menuitem', { name: 'Cancel this receipt' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Reissue this receipt' })).toBeVisible();
    await page.keyboard.press('Escape');
    await signOut(page);

    // 5. As sysadmin check the change log for the receipt id.
    await signIn(page, 'sysadmin');
    await page.goto('/admin/change-log');
    await page.getByLabel('Subject type').selectOption('Receipt');
    await page.getByRole('textbox', { name: 'Subject id' }).fill(ownReceiptId);
    const lostEntry = page.getByRole('row').filter({ hasText: `E2E lost ${sfx}` }).filter({ hasText: '{"lost":false}' });
    await expect(lostEntry).toHaveCount(1);
    await expect(lostEntry).toContainText('{"lost":true}');
  });
});
