// spec: specs/eo-issue-tax-receipt.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { pdfTextFromBuffer, signIn } from '../../helpers.js';
import { addContributor, addPayment, createPeriod, issueSpace, newSuffix, signOut } from './recipe.js';

test.describe('Issue Tax Receipt: issuance and receipt contents', () => {
  test('Row 52: Eligible amount, including a goods-and-services gift with a non-deductible portion', async ({
    page,
  }) => {
    const sfx = newSuffix();
    const periodName = `E2E ${sfx}`;

    // 1. Recipe R1 and R2. R3 payment A: $60 monetary on 2024-01-10. R3 payment B: $100 with
    //    'Donor received goods or services' ticked and Non-deductible ($) 20 on 2024-01-20.
    //    (The plan had two $100 payments a day apart, which raises A6, a possible duplicate,
    //    and blocks the space; a different amount ten days apart does not.)
    //    Issue both with 'One receipt per donor' OFF (R4).
    await signIn(page, 'sysadmin');
    const periodId = await createPeriod(page, sfx);
    await signOut(page);

    await signIn(page, 'admin');
    const donor = await addContributor(page, sfx);
    await addPayment(page, { donorName: donor.name, periodName, amount: 60, receivedOn: '2024-01-10' });
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
    await page.goto(`/spaces/${periodId}/PARTY/issue`);
    await expect(page.getByText('Total amount', { exact: true })).toBeVisible();
    const donorRows = page.getByRole('row').filter({ has: page.getByRole('link', { name: donor.name }) });
    await expect(donorRows).toHaveCount(2);
    await expect(donorRows.filter({ hasText: '$60.00' })).toHaveCount(1);
    await expect(donorRows.filter({ hasText: '$80.00' })).toHaveCount(1);

    const { receiptNumbers } = await issueSpace(page, periodId, { reason: `E2E issue ${sfx}` });
    await expect(page.getByText('2 issued, 0 failed.')).toBeVisible();
    expect(receiptNumbers).toHaveLength(2);

    // 2. Fetch each PDF.
    const resultRows = page.getByRole('row').filter({ has: page.getByText(/^GPO-00\d{6}$/) });
    await expect(resultRows).toHaveCount(2);

    const monetaryRow = resultRows.filter({ hasText: '$60.00' });
    await expect(monetaryRow).toHaveCount(1);
    const monetaryHref = (await monetaryRow.getByRole('link', { name: 'View PDF' }).getAttribute('href'))!;
    const monetaryResponse = await page.request.get(monetaryHref);
    expect(monetaryResponse.status()).toBe(200);
    const monetaryText = await pdfTextFromBuffer(await monetaryResponse.body());
    expect(monetaryText).toContain('Eligible Amount: $60.00');

    const goodsRow = resultRows.filter({ hasText: '$80.00' });
    await expect(goodsRow).toHaveCount(1);
    const goodsHref = (await goodsRow.getByRole('link', { name: 'View PDF' }).getAttribute('href'))!;
    const goodsResponse = await page.request.get(goodsHref);
    expect(goodsResponse.status()).toBe(200);
    const goodsText = await pdfTextFromBuffer(await goodsResponse.body());
    expect(goodsText).toContain('Eligible Amount: $80.00');
    expect(goodsText).not.toContain('Eligible Amount: $100.00');

    // 3. Read-only cross-check with the seeded fixture Goods Gita in period 9503: open her
    //    contribution from /contributors, fetch her receipt's 'View PDF'.
    await page.goto('/contributors');
    await page.getByRole('link', { name: 'Goods Gita' }).click();
    await page.getByRole('row').filter({ hasText: '9503' }).getByRole('link').first().click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    const gitaHref = (await page.getByRole('link', { name: 'View PDF' }).first().getAttribute('href'))!;
    const gitaResponse = await page.request.get(gitaHref);
    expect(gitaResponse.status()).toBe(200);
    const gitaText = await pdfTextFromBuffer(await gitaResponse.body());
    expect(gitaText).toContain('Eligible Amount: $80.00');
    expect(gitaText).toContain('Contribution Type: Goods and Services');
  });
});
