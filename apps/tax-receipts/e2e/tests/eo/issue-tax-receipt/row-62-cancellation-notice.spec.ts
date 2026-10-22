// spec: specs/eo-issue-tax-receipt.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { pdfTextFromBuffer, signIn } from '../../helpers.js';
import { addContributor, addPayment, createPeriod, issueSpace, newSuffix, signOut } from './recipe.js';

test.describe('Issue Tax Receipt: corrections', () => {
  test('Row 62: Cancellation notice opens the CANCELLED copy and Email to donor queues it', async ({ page }) => {
    const sfx = newSuffix();
    const email = `iris.${sfx}@e2e.test`;

    // 1. Recipe R1 to R4 with one $50 payment (the contributor has an email on file). As cfo cancel
    //    the receipt as in Row 61 (reason 'E2E cancel'). Close the modal.
    await signIn(page, 'sysadmin');
    const periodId = await createPeriod(page, sfx);
    await signOut(page);

    await signIn(page, 'admin');
    const donor = await addContributor(page, sfx);
    await addPayment(page, { donorName: donor.name, periodName: `E2E ${sfx}`, amount: 50, receivedOn: '2024-01-10' });
    await signOut(page);

    await signIn(page, 'cfo');
    const { receiptNumbers } = await issueSpace(page, periodId, { reason: `E2E issue ${sfx}` });
    expect(receiptNumbers).toHaveLength(1);
    const receiptNumber = receiptNumbers[0]!;
    const resultRow = page.getByRole('row').filter({ hasText: receiptNumber });
    await resultRow.getByRole('link', { name: /^c[a-z0-9]{20,}$/ }).click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);

    const receiptRow = page.getByRole('row').filter({ hasText: receiptNumber });
    await page.getByRole('button', { name: `Correct receipt ${receiptNumber}` }).click();
    await page.getByRole('menuitem', { name: 'Cancel this receipt' }).click();
    const cancelDialog = page.getByRole('dialog');
    await cancelDialog.getByRole('textbox', { name: 'Reason (required)' }).fill(`E2E cancel ${sfx}`);
    await cancelDialog.getByRole('button', { name: 'Confirm' }).click();
    // live, the modal closes itself after a successful cancel
    await expect(cancelDialog).toBeHidden();
    await expect(receiptRow).toContainText('CANCELLED');
    await expect(receiptRow.getByRole('link', { name: 'View PDF' })).toBeVisible();
    const noticeLink = receiptRow.getByRole('link', { name: 'Cancellation notice' });
    await expect(noticeLink).toBeVisible();
    const emailButton = receiptRow.getByRole('button', { name: 'Email to donor' });
    await expect(emailButton).toBeVisible();

    // 2. Take the 'Cancellation notice' href (/api/receipts/<id>/cancellation-notice), fetch it with
    //    page.request, and extract text.
    const noticeHref = (await noticeLink.getAttribute('href'))!;
    expect(noticeHref).toMatch(/^\/api\/receipts\/[^/]+\/cancellation-notice$/);
    const response = await page.request.get(noticeHref);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/pdf');
    const text = await pdfTextFromBuffer(await response.body());
    expect(text).toContain('CANCELLED');
    expect(text).toContain(receiptNumber);

    // 3. Click 'Email to donor'.
    await emailButton.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: `Email the cancellation notice: ${receiptNumber}` })).toBeVisible();
    await expect(dialog).toContainText(`Queues an email to ${email}`);
    await expect(dialog.getByRole('textbox', { name: 'Subject' })).toHaveValue('Your tax receipt has been cancelled');
    const queue = dialog.getByRole('button', { name: 'Queue email' });
    await expect(queue).toBeDisabled();

    // 4. Fill Letter 'Your receipt was cancelled; the cancelled copy is attached.' and reason
    //    'E2E notice', click 'Queue email'.
    const letter = `Your receipt was cancelled; the cancelled copy is attached. ${sfx}`;
    await dialog.getByRole('textbox', { name: 'Letter' }).fill(letter);
    await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill(`E2E notice ${sfx}`);
    await expect(queue).toBeEnabled();
    await queue.click();
    await expect(dialog).toBeHidden();
    await expect(receiptRow).toContainText(`queued to ${email}`);
    await expect(receiptRow.getByRole('button', { name: 'Email to donor' })).toHaveCount(0);
    // the row does not refresh by itself, so reload until the background sender has run
    await expect(async () => {
      await page.reload();
      await expect(receiptRow).toHaveText(new RegExp(`sent to ${email.replace(/\./g, '\\.')} \\(simulated\\)`));
    }).toPass({ timeout: 30_000 });
    await signOut(page);

    // 5. Sign in as sysadmin, open /admin/emails, set the Kind filter to 'Cancellation notice' and
    //    Search for the contributor's email.
    await signIn(page, 'sysadmin');
    await page.goto('/admin/emails');
    await page.getByLabel('Kind').selectOption('Cancellation notice');
    await page.getByRole('textbox', { name: 'Search' }).fill(email);
    const emailRow = page.getByRole('row').filter({ hasText: email });
    await expect(emailRow).toHaveCount(1);
    await expect(emailRow).toContainText(donor.name);
    await expect(emailRow).toContainText(`Receipt ${receiptNumber}`);
    await expect(emailRow).toContainText('Your tax receipt has been cancelled');
    await expect(emailRow).toContainText('SENT');
    await expect(emailRow).toContainText('simulated');

    // 6. Click the row.
    await emailRow.click();
    const main = page.getByRole('main');
    await expect(main.getByText('Provider: dev')).toBeVisible();
    await expect(main.getByText('Attached receipt PDF')).toBeVisible();
    await expect(main.getByText(`Re: Receipt ${receiptNumber}`)).toBeVisible();
    await expect(main.getByText(letter)).toBeVisible();
  });
});
