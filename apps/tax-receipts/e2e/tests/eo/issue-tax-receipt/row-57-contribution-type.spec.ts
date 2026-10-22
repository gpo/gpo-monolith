// spec: specs/eo-issue-tax-receipt.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { pdfTextFromBuffer, signIn } from '../../helpers.js';
import { addContributor, addPayment, createPeriod, issueSpace, newSuffix, signOut } from './recipe.js';

test.describe('Issue Tax Receipt: issuance and receipt contents', () => {
  test('Row 57: Contribution type on the receipt (Monetary vs Goods and Services)', async ({ page }) => {
    const sfx = newSuffix();
    const periodName = `E2E ${sfx}`;

    // 1. Recipe R1 and R2. R3 payment A $50 monetary; R3 payment B $100 goods and services with
    //    Non-deductible ($) 20. Issue both (R4, 'One receipt per donor' OFF). Fetch both PDFs.
    //    (Payment B is dated ten days after A, with a different amount, so rule A6 does not block the space.)
    await signIn(page, 'sysadmin');
    const periodId = await createPeriod(page, sfx);
    await signOut(page);

    await signIn(page, 'admin');
    const donor = await addContributor(page, sfx);
    await addPayment(page, { donorName: donor.name, periodName, amount: 50, receivedOn: '2024-01-10' });
    await addPayment(page, {
      donorName: donor.name,
      periodName,
      amount: 100,
      receivedOn: '2024-01-20',
      goodsOrServices: true,
      nonDeductible: 20,
    });
    await signOut(page);

    await signIn(page, 'cfo');
    const { receiptNumbers } = await issueSpace(page, periodId, { reason: `E2E issue ${sfx}` });
    await expect(page.getByText('2 issued, 0 failed.')).toBeVisible();
    expect(receiptNumbers).toHaveLength(2);

    const resultRows = page.getByRole('row').filter({ has: page.getByText(/^GPO-00\d{6}$/) });
    await expect(resultRows).toHaveCount(2);

    // Receipt A: monetary, eligible amount $50.00
    const monetaryRow = resultRows.filter({ hasText: '$50.00' });
    await expect(monetaryRow).toHaveCount(1);
    const monetaryHref = (await monetaryRow.getByRole('link', { name: 'View PDF' }).getAttribute('href'))!;
    const monetaryResponse = await page.request.get(monetaryHref);
    expect(monetaryResponse.status()).toBe(200);
    const monetaryText = await pdfTextFromBuffer(await monetaryResponse.body());
    expect(monetaryText).toContain('Contribution Type: Monetary');

    // Receipt B: goods and services, eligible amount $80.00 ($100 less $20 non-deductible)
    const goodsRow = resultRows.filter({ hasText: '$80.00' });
    await expect(goodsRow).toHaveCount(1);
    const goodsHref = (await goodsRow.getByRole('link', { name: 'View PDF' }).getAttribute('href'))!;
    const goodsResponse = await page.request.get(goodsHref);
    expect(goodsResponse.status()).toBe(200);
    const goodsText = await pdfTextFromBuffer(await goodsResponse.body());
    expect(goodsText).toContain('Contribution Type: Goods and Services');
    expect(goodsText).not.toContain('Contribution Type: Monetary');
  });
});
