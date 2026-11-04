// spec: specs/eo-issue-tax-receipt.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { signIn } from '../../helpers.js';
import { addContributor, addPayment, createPeriod, issueSpace, newSuffix, signOut } from './recipe.js';

test.describe('Issue Tax Receipt: delivery', () => {
  test('Row 64: Emailed receipt is queued from Deliver and appears in Admin > Emails with the PDF attached', async ({
    page,
  }) => {
    const sfx = newSuffix();

    // 1. Read-only: Email Emma. As cfo open /spaces/9503/PARTY/issue, click 'Go to delivery'.
    //    Do NOT type a letter or send.
    await signIn(page, 'cfo');
    await page.goto('/spaces/9503/PARTY/issue');
    await expect(page.getByText('Nothing to issue')).toBeVisible();
    await page.getByRole('button', { name: 'Go to delivery' }).click();
    await expect(page.getByText('Ready to send', { exact: true }).locator('..')).toHaveText(/^Ready to send\s*1$/);
    // disabled: no letter or reason (Send is never clicked on this seeded space)
    await expect(page.getByRole('button', { name: 'Send 1 email(s)' })).toBeDisabled();
    await signOut(page);

    // 2. Live, own data. Recipe R1 to R3 with one $50 payment, then as cfo issue with
    //    'Force email for all'.
    await signIn(page, 'sysadmin');
    const periodId = await createPeriod(page, sfx);
    await signOut(page);

    await signIn(page, 'admin');
    const donor = await addContributor(page, sfx);
    await addPayment(page, { donorName: donor.name, periodName: `E2E ${sfx}`, amount: 50, receivedOn: '2024-01-10' });
    await signOut(page);

    await signIn(page, 'cfo');
    const { receiptNumbers } = await issueSpace(page, periodId, {
      delivery: 'Force email for all',
      reason: `E2E issue ${sfx}`,
    });
    await expect(page.getByText('1 issued, 0 failed.')).toBeVisible();
    expect(receiptNumbers).toHaveLength(1);
    const receiptNumber = receiptNumbers[0]!;
    const contributionHref = (await page
      .getByRole('link', { name: /^c[a-z0-9]{20,}$/ })
      .first()
      .getAttribute('href'))!;
    expect(contributionHref).toMatch(/^\/contributions\/[^/]+$/);
    const readyToSend = page.getByText('Ready to send', { exact: true }).locator('..');
    await expect(readyToSend).toHaveText(/^Ready to send\s*1$/);
    await expect(page.getByText('Ready to print', { exact: true }).locator('..')).toHaveText(/^Ready to print\s*0$/);

    // 3. Fill the cover Letter, the Reason, keep the Subject; then click 'Send 1 email(s)'.
    const send = page.getByRole('button', { name: 'Send 1 email(s)' });
    await expect(send).toBeDisabled();
    await page.getByRole('textbox', { name: 'Letter' }).fill('Thank you for your support.');
    await expect(send).toBeDisabled();
    await expect(page.getByRole('textbox', { name: 'Subject' })).toHaveValue('Your official contribution receipt');
    await page.getByRole('textbox', { name: 'Reason (required)' }).fill(`E2E deliver ${sfx}`);
    await expect(send).toBeEnabled();
    await send.click();
    await expect(readyToSend).toHaveText(/^Ready to send\s*0$/);
    // sending is background and simulated: Sending, Sent, or Delivered reaches 1
    const counts = ['Sending', 'Sent', 'Delivered'].map((label) =>
      page.getByText(label, { exact: true }).locator('..'),
    );
    await expect(async () => {
      let total = 0;
      for (const count of counts) {
        total += Number(((await count.textContent()) ?? '').replace(/\D/g, ''));
      }
      expect(total).toBe(1);
    }).toPass();
    await signOut(page);

    // 4. Sign in as sysadmin, open /admin/emails, Search for the contributor's email, Kind 'Receipt'.
    await signIn(page, 'sysadmin');
    await page.goto('/admin/emails');
    await page.getByRole('textbox', { name: 'Search' }).fill(`iris.${sfx}@e2e.test`);
    await page.getByLabel('Kind').selectOption('Receipt');
    const main = page.getByRole('main');
    const emailRow = main.getByRole('row').filter({ hasText: `iris.${sfx}@e2e.test` });
    await expect(emailRow).toHaveCount(1);
    await expect(emailRow).toContainText(donor.name);
    await expect(emailRow).toContainText(`Receipt ${receiptNumber}`);
    await expect(emailRow).toContainText('Your official contribution receipt');
    // the status may still be queued or sending for a moment: reload until it is SENT
    await expect(async () => {
      await page.reload();
      await page.getByRole('textbox', { name: 'Search' }).fill(`iris.${sfx}@e2e.test`);
      await page.getByLabel('Kind').selectOption('Receipt');
      await expect(emailRow).toContainText('SENT', { timeout: 1000 });
    }).toPass();
    await expect(emailRow).toContainText('simulated');
    await expect(main.getByText('Simulated: nothing is sent')).toBeVisible();

    // 5. Click the row.
    await emailRow.click();
    await expect(main.getByText('Provider: dev')).toBeVisible();
    await expect(main.getByText(/Message id: simulated_/)).toBeVisible();
    await expect(main.getByText('Attached receipt PDF')).toBeVisible();
    await expect(main.getByText(`Re: Receipt ${receiptNumber}`)).toBeVisible();
    await expect(main.getByText('Thank you for your support.')).toBeVisible();
    await signOut(page);

    // 6. Back as cfo open the contribution page: sending an email does not alter the receipt.
    await signIn(page, 'cfo');
    await page.goto(contributionHref);
    const receiptRow = page.getByRole('row').filter({ hasText: receiptNumber });
    await expect(receiptRow).toContainText('ISSUED');
    await expect(receiptRow).toContainText('$50.00');
    await expect(receiptRow.getByRole('link', { name: 'View PDF' })).toBeVisible();
  });
});
