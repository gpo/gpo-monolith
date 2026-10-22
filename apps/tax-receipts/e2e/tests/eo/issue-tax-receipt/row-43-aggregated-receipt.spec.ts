// spec: specs/eo-issue-tax-receipt.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { pdfTextFromBuffer, signIn } from '../../helpers.js';
import { addContributor, addPayment, createPeriod, newSuffix, signOut } from './recipe.js';

test.describe('Issue Tax Receipt: issuance and receipt contents', () => {
  test('Row 43: Aggregated receipt records each contribution (Consolidating Chris read-only, plus a live combine)', async ({
    page,
  }) => {
    const sfx = newSuffix();

    // 1. Read-only fixture. Sign in as cfo, open /contributors, search 'Consolidating', open Consolidating Chris.
    await signIn(page, 'cfo');
    await page.goto('/contributors');
    await page.getByRole('textbox', { name: 'Search' }).fill('Consolidating');
    await page.getByRole('link', { name: 'Consolidating Chris' }).click();
    await expect(page).toHaveURL(/\/contributors\/[^/]+$/);
    const row40 = page.getByRole('row').filter({ hasText: '$40.00' });
    const row25 = page.getByRole('row').filter({ hasText: '$25.00' });
    for (const row of [row40, row25]) {
      await expect(row).toContainText('9504');
      await expect(row).toContainText('ACTIVE');
      await expect(row.getByRole('cell', { name: '$0.00', exact: true })).toBeVisible();
    }

    // 2. Open each contribution (links in the Accepted column) and read 'Allocations & receipts'.
    await row40.getByRole('link').click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    const row40Receipt = page.getByRole('row').filter({ hasText: 'ISSUED' });
    await expect(row40Receipt).toContainText('$40.00');
    const receiptNo = (await row40Receipt.getByRole('cell').first().textContent())!;
    expect(receiptNo).toMatch(/^GPO-00\d{6}$/);
    const fixtureHref = (await row40Receipt.getByRole('link', { name: 'View PDF' }).getAttribute('href'))!;

    await page.goBack();
    await row25.getByRole('link').click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    const row25Receipt = page.getByRole('row').filter({ hasText: 'ISSUED' });
    await expect(row25Receipt).toContainText(receiptNo);
    await expect(row25Receipt).toContainText('$25.00');

    // 3. Fetch the receipt's 'View PDF' and extract text.
    const fixtureResponse = await page.request.get(fixtureHref);
    expect(fixtureResponse.status()).toBe(200);
    const fixtureText = await pdfTextFromBuffer(await fixtureResponse.body());
    expect(fixtureText).toContain('$65.00');
    expect(fixtureText).toContain('Received on: 2030-03-05 to 2030-03-10');
    await signOut(page);

    // 4. Live part. Recipe R1 and R2, then R3 twice ($40 on 2024-01-10, $25 on 2024-01-15).
    //    Sign in as cfo and open the contributor's record.
    // NOTE: this live part could not be driven in the browser session (sign-in as sysadmin was
    // denied), so it is built from the proven recipe helpers and the plan, not verified live.
    await signIn(page, 'sysadmin');
    await createPeriod(page, sfx);
    await signOut(page);

    await signIn(page, 'admin');
    const donor = await addContributor(page, sfx);
    const periodName = `E2E ${sfx}`;
    await addPayment(page, { donorName: donor.name, periodName, amount: 40, receivedOn: '2024-01-10' });
    await addPayment(page, { donorName: donor.name, periodName, amount: 25, receivedOn: '2024-01-15' });
    await signOut(page);

    await signIn(page, 'cfo');
    await page.goto(`/contributors/${donor.id}`);
    await expect(
      page.getByText('Tick two or more contributions to issue one receipt for all of them.'),
    ).toBeVisible();
    const boxes = page.getByRole('checkbox', { name: /Select the contribution of/ });
    await expect(boxes).toHaveCount(2);

    // 5. Tick both checkboxes.
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await expect(page.getByText('One receipt for 2 contributions, totalling $65.00.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: /Received-by label/ })).toHaveValue('Green Party of Ontario');
    const reason = page.getByRole('textbox', { name: /Reason/ });
    await expect(reason).toBeVisible();
    const issue = page.getByRole('button', { name: 'Issue one receipt' });
    await expect(issue).toBeDisabled();

    // 6. Fill the reason 'E2E combine' and click 'Issue one receipt'.
    await reason.fill('E2E combine');
    await expect(issue).toBeEnabled();
    await issue.click();
    const alert = page.getByRole('alert').filter({ hasText: /Issued GPO-00\d{6} for \$65\.00\./ });
    await expect(alert).toBeVisible();
    const newNumber = (await alert.textContent())!.match(/GPO-00\d{6}/)![0];

    // 7. Fetch that PDF.
    const href = (await alert.getByRole('link', { name: 'View PDF' }).getAttribute('href'))!;
    const response = await page.request.get(href);
    expect(response.status()).toBe(200);
    const text = await pdfTextFromBuffer(await response.body());
    expect(text).toContain('$65.00');
    expect(text).toContain('Received on: 2024-01-10 to 2024-01-15');
    expect(text).toContain(newNumber);
    const leftCells = page.getByRole('row').filter({ has: page.getByRole('link') }).getByRole('cell', {
      name: '$0.00',
      exact: true,
    });
    await expect(leftCells).toHaveCount(2);
    await page.getByRole('row').filter({ hasText: '$40.00' }).getByRole('link').click();
    await expect(page.getByRole('cell', { name: newNumber, exact: true })).toBeVisible();
    await page.goBack();
    await page.getByRole('row').filter({ hasText: '$25.00' }).getByRole('link').click();
    await expect(page.getByRole('cell', { name: newNumber, exact: true })).toBeVisible();
  });
});
