// spec: specs/eo-issue-tax-receipt.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { pdfTextFromBuffer, signIn } from '../../helpers.js';
import { addContributor, addPayment, createPeriod, issueSpace, newSuffix, signOut } from './recipe.js';

test.describe('Issue Tax Receipt: receipt records and audit', () => {
  test('Row 42: Receipt records its allocation, an immutable address and name snapshot, and the stored PDF', async ({
    page,
  }) => {
    // Known app bug: a reissued receipt keeps the donor's OLD name because
    // api/src/corrections/cancel.ts copies receipt.contactNameSnapshot, while
    // the user guide says a reissue uses current data. Expected to fail until fixed.
    test.fail();
    const sfx = newSuffix();
    const upper = sfx.toUpperCase();

    async function fetchPdfText(href: string): Promise<string> {
      const response = await page.request.get(href);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('application/pdf');
      return pdfTextFromBuffer(await response.body());
    }

    // 1. Recipe R1 to R3 with ONE $50 payment on 2024-01-10, then R4 to issue. Remember the receipt
    //    number and the contribution link.
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
    await expect(page.getByText('1 issued, 0 failed.')).toBeVisible();
    expect(receiptNumbers).toHaveLength(1);
    const receiptNumber = receiptNumbers[0]!;
    const resultRow = page.getByRole('row').filter({ has: page.getByText(receiptNumber, { exact: true }) });
    const contributionHref = (await resultRow.getByRole('link', { name: /^c[a-z0-9]{20,}$/ }).getAttribute('href'))!;
    expect(contributionHref).toMatch(/^\/contributions\/[^/]+$/);

    // 2. Open the contribution page /contributions/<id>.
    await page.goto(contributionHref);
    const receiptRow = page.getByRole('row').filter({ hasText: receiptNumber });
    await expect(receiptRow).toContainText('ISSUED');
    await expect(receiptRow).toContainText('$50.00');
    // the issue date shows in the browser locale (the local date of today)
    const today = await page.evaluate(() => new Date().toLocaleDateString());
    await expect(receiptRow).toContainText(today);
    const viewPdf = receiptRow.getByRole('link', { name: 'View PDF' });
    await expect(viewPdf).toBeVisible();
    await expect(page.getByText('Address on file', { exact: true }).locator('..')).toContainText(
      '77 Maple Ave, Ottawa ON K1A 0B1, CA',
    );
    const pdfHref = (await viewPdf.getAttribute('href'))!;
    expect(pdfHref).toMatch(/^\/api\/receipts\/[^/]+\/pdf$/);

    // 3. Fetch 'View PDF' twice (a stored PDF, not a re-render) and extract the text of both.
    const firstText = await fetchPdfText(pdfHref);
    const secondText = await fetchPdfText(pdfHref);
    expect(secondText).toBe(firstText);
    expect(firstText).toContain(receiptNumber);
    expect(firstText).toContain(`IRIS ISSUER${upper}`);
    expect(firstText).toContain('77 MAPLE AVE');
    expect(firstText).toContain('K1A0B1');
    await signOut(page);

    // 4. As admin open the contributor record, choose 'Edit contributor', change Street to 'Elm Court'
    //    AND Last name to 'Renamed<S>' (the address stays complete), Reason 'E2E edit after issue',
    //    click 'Save changes'.
    await signIn(page, 'admin');
    await page.goto(`/contributors/${donor.id}`);
    await expect(page.getByText('Address: 77 Maple Ave, Ottawa ON K1A 0B1, CA')).toBeVisible();
    const historyToggle = page.getByRole('button', { name: /^Show \d+ changes?$/ });
    const changesBefore = Number((await historyToggle.textContent())!.match(/\d+/)![0]);
    await page.getByRole('button', { name: 'Edit contributor' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Street', { exact: true }).fill('Elm Court');
    await dialog.getByLabel('Last name').fill(`Renamed${sfx}`);
    await dialog.getByLabel('Reason (required)').fill(`E2E edit after issue ${sfx}`);
    const save = dialog.getByRole('button', { name: 'Save changes' });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText('Address: 77 Elm Court, Ottawa ON K1A 0B1, CA')).toBeVisible();
    await expect(page.getByRole('heading', { name: `Iris Renamed${sfx}` })).toBeVisible();
    await expect(page.getByText(`Last name: Renamed${sfx}`)).toBeVisible();
    await expect(page.getByRole('button', { name: `Show ${changesBefore + 1} changes` })).toBeVisible();
    await signOut(page);

    // 5. Fetch the ORIGINAL receipt's 'View PDF' again.
    //    (Still signed out of admin; the PDF needs a session, so sign in as cfo first.)
    await signIn(page, 'cfo');
    const afterEditText = await fetchPdfText(pdfHref);
    expect(afterEditText).toBe(firstText);
    expect(afterEditText).toContain('77 MAPLE AVE');
    expect(afterEditText).toContain(`IRIS ISSUER${upper}`);
    expect(afterEditText).not.toContain('ELM COURT');
    expect(afterEditText).not.toContain('RENAMED');

    // 6. Contrast: as cfo, on the contribution page choose the receipt's 'Correct' menu then
    //    'Reissue this receipt', fill Reason 'E2E reissue after address fix', keep the label, click
    //    Confirm. Fetch the replacement receipt's PDF.
    await page.goto(contributionHref);
    await page.getByRole('button', { name: `Correct receipt ${receiptNumber}` }).click();
    await page.getByRole('menuitem', { name: 'Reissue this receipt' }).click();
    const reissue = page.getByRole('dialog');
    await reissue.getByRole('textbox', { name: 'Reason (required)' }).fill(`E2E reissue after address fix ${sfx}`);
    const confirm = reissue.getByRole('button', { name: 'Confirm' });
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(receiptRow).toContainText('CANCELLED');
    const replacementRow = page
      .getByRole('row')
      .filter({ has: page.getByText(/^GPO-00\d{6}$/) })
      .filter({ hasText: 'ISSUED' });
    await expect(replacementRow).toHaveCount(1);
    await expect(replacementRow).not.toContainText(receiptNumber);
    const replacementHref = (await replacementRow.getByRole('link', { name: 'View PDF' }).getAttribute('href'))!;
    expect(replacementHref).not.toBe(pdfHref);
    const replacementText = await fetchPdfText(replacementHref);
    expect(replacementText).toContain('77 ELM COURT');
    expect(replacementText).toContain(`RENAMED${upper}`);
    expect(replacementText).not.toContain('77 MAPLE AVE');
  });
});
