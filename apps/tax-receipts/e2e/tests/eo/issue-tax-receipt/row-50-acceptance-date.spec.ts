// spec: specs/eo-issue-tax-receipt.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { pdfTextFromBuffer, signIn } from '../../helpers.js';
import { addContributor, addPayment, createPeriod, issueSpace, newSuffix, signOut } from './recipe.js';

test.describe('Issue Tax Receipt: issuance and receipt contents', () => {
  test("Row 50: Contribution acceptance date on the receipt ('Received on')", async ({ page }) => {
    const sfx = newSuffix();

    // 1. Recipe R1 and R2; in R3 enter a payment with Received on 2024-01-10 and 'Accepted on' 2024-01-17.
    //    Issue with R4 and fetch the PDF.
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
    await issueSpace(page, periodId, { reason: `E2E issue ${sfx}` });
    await expect(page.getByText('1 issued, 0 failed.')).toBeVisible();

    const row = page.getByRole('row').filter({ has: page.getByText(/^GPO-00\d{6}$/) });
    const href = (await row.getByRole('link', { name: 'View PDF' }).getAttribute('href'))!;
    const response = await page.request.get(href);
    expect(response.status()).toBe(200);
    const text = await pdfTextFromBuffer(await response.body());
    expect(text).toContain('Received on: 2024-01-17');
    expect(text).not.toContain('Received on: 2024-01-10');

    // The contribution page shows Accepted on 1/17/2024 (locale formatted by the browser).
    await row.getByRole('link', { name: /^c[a-z0-9]{20,}$/ }).click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    // the accepted date is stored at local midnight, so format a local date
    const expectedDate = await page.evaluate(() => new Date(2024, 0, 17).toLocaleDateString());
    await expect(page.getByText('Accepted on', { exact: true }).locator('..')).toContainText(expectedDate);
  });
});
