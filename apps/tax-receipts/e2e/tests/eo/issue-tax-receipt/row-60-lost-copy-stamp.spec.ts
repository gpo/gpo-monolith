// spec: specs/eo-issue-tax-receipt.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { pdfTextFromBuffer, signIn } from '../../helpers.js';
import { addContributor, addPayment, createPeriod, issueSpace, newSuffix, signOut } from './recipe.js';

// The template prints "Duplicate Copy" on parts 2 and 3 of every receipt, so compare the count of
// the standalone upper-case stamp rather than a case-insensitive substring.
const stampCount = (text: string) => (text.match(/\bCOPY\b/g) ?? []).length;

test.describe('Issue Tax Receipt: corrections', () => {
  test('Row 60: The lost-receipt reprint is stamped COPY', async ({ page }) => {
    const sfx = newSuffix();

    // 1. Recipe R1 to R4 with one payment, then 'Reprint as a lost-receipt copy' (reason 'E2E lost copy'),
    //    capturing the POST /api/receipts/<id>/reprint response.
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
    const ownHref = (await resultRow.getByRole('link', { name: 'View PDF' }).getAttribute('href'))!;
    const receiptId = ownHref.match(/^\/api\/receipts\/([^/]+)\/pdf$/)![1]!;
    await resultRow.getByRole('link', { name: /^c[a-z0-9]{20,}$/ }).click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);

    await page.getByRole('button', { name: `Correct receipt ${receiptNumber}` }).click();
    await page.getByRole('menuitem', { name: 'Reprint as a lost-receipt copy' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill(`E2E lost copy ${sfx}`);
    const confirm = dialog.getByRole('button', { name: 'Confirm' });
    await expect(confirm).toBeEnabled();
    const reprintResponse = page.waitForResponse(
      (r) => r.url().endsWith(`/api/receipts/${receiptId}/reprint`) && r.request().method() === 'POST',
    );
    await confirm.click();
    const response = await reprintResponse;
    // expect: 201 with kind LOST_COPY and lost true
    expect(response.status()).toBe(201);
    const body = await response.json();
    const reprint = body.data ?? body;
    expect(reprint.kind).toBe('LOST_COPY');
    expect(JSON.stringify(body)).toMatch(/"lost":\s*true/);
    const reprintId: string = reprint.reprintId ?? reprint.id;
    expect(reprintId).toBeTruthy();
    await expect(dialog.getByText('Copy generated; the original is flagged lost.')).toBeVisible();

    // 2. GET /api/receipts/<id>/reprints/<reprintId>/pdf and extract its text.
    const reprintPdf = await page.request.get(`/api/receipts/${receiptId}/reprints/${reprintId}/pdf`);
    expect(reprintPdf.status()).toBe(200);
    const reprintText = await pdfTextFromBuffer(await reprintPdf.body());
    expect(reprintText).toContain(receiptNumber);
    expect(stampCount(reprintText)).toBeGreaterThan(0);
    const originalPdf = await page.request.get(ownHref);
    const originalText = await pdfTextFromBuffer(await originalPdf.body());
    expect(originalText).toContain(receiptNumber);
    expect(stampCount(originalText)).toBe(0);

    // 3. Read-only cross-check with Lost Lena (9503): her receipt's first reprint is a LOST_COPY.
    await page.goto('/contributors');
    await page.getByRole('link', { name: 'Lost Lena' }).click();
    await expect(page.getByRole('heading', { name: 'Lost Lena' })).toBeVisible();
    await page.getByRole('row').filter({ hasText: '$45.00' }).getByRole('link').click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    const lenaRow = page.getByRole('row').filter({ hasText: /GPO-00\d{6}/ });
    const lenaHref = (await lenaRow.getByRole('link', { name: 'View PDF' }).getAttribute('href'))!;
    const lenaId = lenaHref.match(/^\/api\/receipts\/([^/]+)\/pdf$/)![1]!;
    const list = await page.request.get(`/api/receipts/${lenaId}/reprints`);
    expect(list.status()).toBe(200);
    const first = (await list.json()).data[0];
    expect(first.kind).toBe('LOST_COPY');
    const lenaPdf = await page.request.get(`/api/receipts/${lenaId}/reprints/${first.id}/pdf`);
    expect(lenaPdf.status()).toBe(200);
    expect(stampCount(await pdfTextFromBuffer(await lenaPdf.body()))).toBeGreaterThan(0);
  });
});
