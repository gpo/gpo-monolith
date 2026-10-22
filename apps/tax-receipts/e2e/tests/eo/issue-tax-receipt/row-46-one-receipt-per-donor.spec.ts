// spec: specs/eo-issue-tax-receipt.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { pdfTextFromBuffer, signIn } from '../../helpers.js';
import { addContributor, addPayment, createPeriod, newSuffix, signOut } from './recipe.js';

test.describe('Issue Tax Receipt: issuance and receipt contents', () => {
  test("Row 46: Combine a donor's contributions onto one receipt with One receipt per donor, goods and services stay separate", async ({
    page,
  }) => {
    const sfx = newSuffix();
    const periodName = `E2E ${sfx}`;

    // 1. Recipe R1 and R2. Then R3 three times for the same contributor: $50 monetary on 2024-01-10,
    //    $30 monetary on 2024-01-20, and a goods-and-services payment of $100 on 2024-01-25 with
    //    'Donor received goods or services' ticked and Non-deductible ($) 20.
    await signIn(page, 'sysadmin');
    const periodId = await createPeriod(page, sfx);
    await signOut(page);

    await signIn(page, 'admin');
    const donor = await addContributor(page, sfx);
    await addPayment(page, { donorName: donor.name, periodName, amount: 50, receivedOn: '2024-01-10' });
    await addPayment(page, { donorName: donor.name, periodName, amount: 30, receivedOn: '2024-01-20' });
    await addPayment(page, {
      donorName: donor.name,
      periodName,
      amount: 100,
      receivedOn: '2024-01-25',
      goodsOrServices: true,
      nonDeductible: 20,
    });
    await signOut(page);

    // 2. Sign in as cfo, open /spaces/<periodId>/PARTY/issue. With the switch OFF (default), read the preview.
    await signIn(page, 'cfo');
    await page.goto(`/spaces/${periodId}/PARTY/issue`);
    await expect(page.getByText('Total amount', { exact: true })).toBeVisible();
    const receiptsCount = page.getByText('Receipts', { exact: true }).locator('..');
    const totalAmount = page.getByText('Total amount', { exact: true }).locator('..');
    const donorRows = page.getByRole('row').filter({ has: page.getByRole('link', { name: donor.name }) });
    await expect(receiptsCount).toHaveText(/^Receipts\s*3$/);
    await expect(donorRows).toHaveCount(3);
    for (const row of await donorRows.all()) {
      await expect(row.getByRole('cell').nth(1)).toHaveText('1');
    }

    // 3. Turn the 'One receipt per donor' switch ON (click its label) and wait for the preview to refresh.
    await page.getByText('One receipt per donor', { exact: true }).click();
    await expect(page.getByRole('switch', { name: /One receipt per donor/ })).toBeChecked();
    await expect(receiptsCount).toHaveText(/^Receipts\s*2$/);
    await expect(donorRows).toHaveCount(2);
    const combinedRow = donorRows.filter({ has: page.getByRole('cell', { name: '2', exact: true }) });
    await expect(combinedRow).toHaveCount(1);
    await expect(combinedRow).toContainText('$80.00');
    const singleRow = donorRows.filter({ has: page.getByRole('cell', { name: '1', exact: true }) });
    await expect(singleRow).toHaveCount(1);
    await expect(singleRow).toContainText('$80.00');
    await expect(totalAmount).toHaveText(/^Total amount\s*\$160\.00$/);

    // 4. Choose 'Next: generate', fill the reason, click 'Generate receipts'.
    await page.getByRole('button', { name: 'Next: generate' }).click();
    await page.getByRole('textbox', { name: 'Reason for this issuance run (required)' }).fill(`E2E issue ${sfx}`);
    const generate = page.getByRole('button', { name: 'Generate receipts' });
    await expect(generate).toBeEnabled();
    await generate.click();
    await expect(page.getByText('2 issued, 0 failed.')).toBeVisible();
    const resultRows = page.getByRole('row').filter({ has: page.getByText(/^GPO-00\d{6}$/) });
    await expect(resultRows).toHaveCount(2);
    const combinedResult = resultRows.filter({ hasText: 'and 1 more (one combined receipt)' });
    await expect(combinedResult).toHaveCount(1);
    await expect(combinedResult).toContainText('$80.00');
    await expect(combinedResult.getByText(/^GPO-00\d{6}$/)).toBeVisible();
    await expect(combinedResult.getByRole('link', { name: /^c[a-z0-9]{20,}$/ })).toBeVisible();
    const singleResult = resultRows.filter({ hasNotText: 'and 1 more' });
    await expect(singleResult).toHaveCount(1);
    await expect(singleResult).toContainText('$80.00');
    await expect(singleResult.getByText(/^GPO-00\d{6}$/)).toBeVisible();

    // 5. Fetch the combined receipt's 'View PDF' and extract text.
    const combinedHref = (await combinedResult.getByRole('link', { name: 'View PDF' }).getAttribute('href'))!;
    const combinedResponse = await page.request.get(combinedHref);
    expect(combinedResponse.status()).toBe(200);
    const combinedText = await pdfTextFromBuffer(await combinedResponse.body());
    expect(combinedText).toContain('Eligible Amount: $80.00');
    expect(combinedText).toContain('Received on: 2024-01-10 to 2024-01-20');
    expect(combinedText).toContain('Contribution Type: Monetary');

    // 6. Fetch the other receipt's PDF.
    const singleHref = (await singleResult.getByRole('link', { name: 'View PDF' }).getAttribute('href'))!;
    const singleResponse = await page.request.get(singleHref);
    expect(singleResponse.status()).toBe(200);
    const singleText = await pdfTextFromBuffer(await singleResponse.body());
    expect(singleText).toContain('Contribution Type: Goods and Services');
    expect(singleText).toContain('Eligible Amount: $80.00');
  });
});
