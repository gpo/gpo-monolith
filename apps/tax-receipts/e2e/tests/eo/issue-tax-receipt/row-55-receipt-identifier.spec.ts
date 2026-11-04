// spec: specs/eo-issue-tax-receipt.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { pdfTextFromBuffer, signIn } from '../../helpers.js';
import { addContributor, addPayment, createPeriod, issueSpace, newSuffix, signOut } from './recipe.js';

test.describe('Issue Tax Receipt: issuance and receipt contents', () => {
  test('Row 55: Unique receipt identifier on the receipt', async ({ page }) => {
    const sfx = newSuffix();

    // 1. Recipe R1 to R4 with two payments so two receipts are issued. Fetch both PDFs.
    await signIn(page, 'sysadmin');
    const periodId = await createPeriod(page, sfx);
    await signOut(page);

    await signIn(page, 'admin');
    const donor = await addContributor(page, sfx);
    const periodName = `E2E ${sfx}`;
    // Different amounts and dates a week or more apart, so validation rule A6
    // (possible duplicate) does not block the space.
    await addPayment(page, { donorName: donor.name, periodName, amount: 50, receivedOn: '2024-01-10' });
    await addPayment(page, { donorName: donor.name, periodName, amount: 30, receivedOn: '2024-01-20' });
    await signOut(page);

    await signIn(page, 'cfo');
    const { receiptNumbers } = await issueSpace(page, periodId, { reason: `E2E issue ${sfx}` });
    expect(receiptNumbers).toHaveLength(2);

    const resultRows = page.getByRole('row').filter({ has: page.getByText(/^GPO-00\d{6}$/) });
    await expect(resultRows).toHaveCount(2);

    const printed: string[] = [];
    for (const row of await resultRows.all()) {
      const shown = (await row.getByText(/^GPO-00\d{6}$/).textContent())!;
      const href = (await row.getByRole('link', { name: 'View PDF' }).getAttribute('href'))!;
      const response = await page.request.get(href);
      expect(response.status()).toBe(200);
      const text = await pdfTextFromBuffer(await response.body());

      // expect: Each text matches /Receipt No: GPO-00\d{6}/.
      const match = text.match(/Receipt No:\s*(GPO-00\d{6})/);
      expect(match).not.toBeNull();
      const id = match![1]!;

      // expect: each identifier equals the number shown in its result row.
      expect(id).toBe(shown);
      printed.push(id);
    }

    // expect: The two identifiers on the PDFs are different.
    expect(printed).toHaveLength(2);
    expect(printed[0]).not.toBe(printed[1]);
  });
});
