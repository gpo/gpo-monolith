// spec: specs/eo-issue-tax-receipt.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { pdfTextFromBuffer, signIn } from '../../helpers.js';
import { addContributor, addPayment, createPeriod, issueSpace, newSuffix, signOut } from './recipe.js';

test.describe('Issue Tax Receipt: issuance and receipt contents', () => {
  test("Row 48: Receipt reads 'Official receipt for income tax purposes'", async ({ page }) => {
    const sfx = newSuffix();

    // 1. Recipe R1 to R4 with one $50 payment; fetch the issued receipt PDF and extract text.
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

    const href = (await page.getByRole('link', { name: 'View PDF' }).first().getAttribute('href'))!;
    expect(href).toMatch(/^\/api\/receipts\/[^/]+\/pdf$/);
    const response = await page.request.get(href);
    expect(response.status()).toBe(200);
    const text = await pdfTextFromBuffer(await response.body());
    expect(text).toContain('This is your Official Receipt for income tax purposes.');
  });
});
