// spec: specs/eo-issue-tax-receipt.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { pdfTextFromBuffer, signIn } from '../../helpers.js';
import { addContributor, addPayment, createPeriod, issueSpace, newSuffix, signOut } from './recipe.js';

test.describe('Issue Tax Receipt: issuance and receipt contents', () => {
  test('Row 47: Receipt numbers are sequential (two receipts issued in a row differ by one)', async ({ page }) => {
    const sfx = newSuffix();

    // 1. Recipe R1 to R3 with TWO payments for one contributor ($50 on 2024-01-10, $30 on 2024-01-20).
    //    In the wizard leave 'One receipt per donor' OFF and generate, so two receipts are issued in one run.
    await signIn(page, 'sysadmin');
    const periodId = await createPeriod(page, sfx);
    await signOut(page);

    await signIn(page, 'admin');
    const donor = await addContributor(page, sfx);
    const periodName = `E2E ${sfx}`;
    await addPayment(page, { donorName: donor.name, periodName, amount: 50, receivedOn: '2024-01-10' });
    await addPayment(page, { donorName: donor.name, periodName, amount: 30, receivedOn: '2024-01-20' });
    await signOut(page);

    await signIn(page, 'cfo');
    const { receiptNumbers } = await issueSpace(page, periodId, { reason: `E2E issue ${sfx}` });
    await expect(page.getByText('2 issued, 0 failed.')).toBeVisible();
    expect(receiptNumbers).toHaveLength(2);

    // 2. Read both numbers from the result rows, matching /^GPO-00\d{6}$/ each, and parse the digits as integers.
    const resultRows = page.getByRole('row').filter({ has: page.getByText(/^GPO-00\d{6}$/) });
    await expect(resultRows).toHaveCount(2);
    const rowNumbers: string[] = [];
    for (const row of await resultRows.all()) {
      const number = (await row.getByText(/^GPO-00\d{6}$/).textContent())!;
      expect(number).toMatch(/^GPO-00\d{6}$/);
      rowNumbers.push(number);
    }
    const digits = rowNumbers.map((n) => parseInt(n.replace('GPO-', ''), 10)).sort((a, b) => a - b);
    expect(digits[1]! - digits[0]!).toBe(1);

    // 3. Fetch each 'View PDF' and read 'Receipt No: GPO-...'.
    for (const row of await resultRows.all()) {
      const number = (await row.getByText(/^GPO-00\d{6}$/).textContent())!;
      const href = (await row.getByRole('link', { name: 'View PDF' }).getAttribute('href'))!;
      const response = await page.request.get(href);
      expect(response.status()).toBe(200);
      const text = await pdfTextFromBuffer(await response.body());
      expect(text).toContain(`Receipt No: ${number}`);
    }
  });
});
