// spec: specs/eo-issue-tax-receipt.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { pdfTextFromBuffer, signIn } from '../../helpers.js';
import { addContributor, addPayment, createPeriod, issueSpace, newSuffix, signOut } from './recipe.js';

test.describe('Issue Tax Receipt: issuance and receipt contents', () => {
  test('Row 54: Authorized signature on the receipt', async ({ page }) => {
    const sfx = newSuffix();

    // 1. Recipe R1 to R4 with one payment; fetch the PDF.
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

    await signIn(page, 'cfo');
    const { receiptNumbers } = await issueSpace(page, periodId, { reason: `E2E issue ${sfx}` });
    await expect(page.getByText('1 issued, 0 failed.')).toBeVisible();
    expect(receiptNumbers).toHaveLength(1);

    const href = (await page.getByRole('link', { name: 'View PDF' }).getAttribute('href'))!;
    expect(href).toMatch(/^\/api\/receipts\/[^/]+\/pdf$/);
    const response = await page.request.get(href);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/pdf');
    const text = await pdfTextFromBuffer(await response.body());

    // expect: Text contains 'Authorized Signature'. (The signature image itself cannot be
    // read as text; the label is what is asserted.)
    expect(text).toContain('Authorized Signature');
  });
});
