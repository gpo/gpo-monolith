// spec: specs/eo-issue-tax-receipt.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { pdfTextFromBuffer, signIn } from '../../helpers.js';
import { addContributor, addPayment, createPeriod, issueSpace, newSuffix, signOut } from './recipe.js';

test.describe('Issue Tax Receipt: issuance and receipt contents', () => {
  test('Row 53: Contributor name and address on the receipt', async ({ page }) => {
    const sfx = newSuffix();

    // 1. Recipe R1 to R4 with the contributor 'Iris Issuer<S>' at 77 Maple Ave, Ottawa ON K1A 0B1, CA.
    //    Fetch the PDF.
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
    expect(receiptNumbers).toHaveLength(1);

    const row = page.getByRole('row').filter({ has: page.getByText(/^GPO-00\d{6}$/) });
    await expect(row).toHaveCount(1);
    const href = (await row.getByRole('link', { name: 'View PDF' }).getAttribute('href'))!;
    const response = await page.request.get(href);
    expect(response.status()).toBe(200);
    const text = await pdfTextFromBuffer(await response.body());

    // Name, street, city/province, and postal code are matched separately because text
    // extraction can split or join lines. The postal code prints without its space.
    expect(text).toContain(`IRIS ISSUER${sfx.toUpperCase()}`);
    expect(text).toContain('77 MAPLE AVE');
    expect(text).toContain('OTTAWA');
    expect(text).toContain('ON');
    expect(text).toContain('K1A0B1');
    expect(text).toContain('CA');
  });
});
