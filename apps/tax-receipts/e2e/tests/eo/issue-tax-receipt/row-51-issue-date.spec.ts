// spec: specs/eo-issue-tax-receipt.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { pdfTextFromBuffer, signIn } from '../../helpers.js';
import { addContributor, addPayment, createPeriod, issueSpace, newSuffix, signOut } from './recipe.js';

test.describe('Issue Tax Receipt: issuance and receipt contents', () => {
  test('Row 51: Receipt issue date', async ({ page }) => {
    const sfx = newSuffix();

    // 1. Recipe R1 to R4 with one payment; record before/after (UTC dates) around generating. Fetch the PDF.
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
      acceptedOn: '2024-01-17',
    });
    await signOut(page);

    await signIn(page, 'cfo');
    const before = new Date().toISOString().slice(0, 10);
    await issueSpace(page, periodId, { reason: `E2E issue ${sfx}` });
    const after = new Date().toISOString().slice(0, 10);
    await expect(page.getByText('1 issued, 0 failed.')).toBeVisible();

    const row = page.getByRole('row').filter({ has: page.getByText(/^GPO-00\d{6}$/) });
    const href = (await row.getByRole('link', { name: 'View PDF' }).getAttribute('href'))!;
    const response = await page.request.get(href);
    expect(response.status()).toBe(200);
    const text = await pdfTextFromBuffer(await response.body());

    // Text contains 'Issue Date: ' followed by a date equal to before or after (UTC).
    const match = /Issue Date: (\d{4}-\d{2}-\d{2})/.exec(text);
    expect(match).not.toBeNull();
    const printed = match![1]!;
    expect([before, after]).toContain(printed);
    // The issue date is today, not the 2024 acceptance date.
    expect(printed).not.toBe('2024-01-17');

    // The contribution page's receipt row shows today's date (locale formatted by the browser;
    // accept the days either side to allow for the time zone and a run crossing midnight).
    await row.getByRole('link', { name: /^c[a-z0-9]{20,}$/ }).click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    const acceptable = await page.evaluate(() =>
      [-1, 0, 1].map((d) => new Date(Date.now() + d * 86_400_000).toLocaleDateString()),
    );
    const receiptRow = page.getByRole('row').filter({ has: page.getByText(/^GPO-00\d{6}$/) });
    await expect(receiptRow).toBeVisible();
    const rowText = await receiptRow.innerText();
    expect(acceptable.some((d) => rowText.includes(d))).toBe(true);
  });
});
