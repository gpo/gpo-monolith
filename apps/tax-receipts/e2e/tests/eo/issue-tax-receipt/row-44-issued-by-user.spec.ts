// spec: specs/eo-issue-tax-receipt.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { signIn } from '../../helpers.js';
import { addContributor, addPayment, createPeriod, issueSpace, newSuffix, signOut } from './recipe.js';

test.describe('Issue Tax Receipt: receipt records and audit', () => {
  test('Row 44: The user who generated the receipt is recorded in the change log', async ({ page }) => {
    const sfx = newSuffix();
    const reason = `E2E issue ${sfx}`;

    // 1. Recipe R1 to R4 with one payment and the run reason 'E2E issue <S>'.
    //    From the result row, take the receipt id from the 'View PDF' href (/api/receipts/<id>/pdf).
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
    const { receiptNumbers } = await issueSpace(page, periodId, { reason });
    expect(receiptNumbers).toHaveLength(1);
    const receiptNumber = receiptNumbers[0]!;
    const resultRow = page.getByRole('row').filter({ hasText: receiptNumber });
    const href = (await resultRow.getByRole('link', { name: 'View PDF' }).getAttribute('href'))!;
    const receiptId = href.match(/^\/api\/receipts\/([^/]+)\/pdf$/)?.[1];
    expect(receiptId).toBeTruthy();

    // 3 (done while still signed in as cfo). Open the contribution page and expand 'Show N changes'.
    // The plan expected the issuance reason to be listed there, but the app's contribution
    // Change history only reads Contribution/Payment entries (api/src/contributions/detail.ts);
    // the issuance is logged against the Receipt, so it is not shown. We only check that the
    // panel opens; the reason is asserted in the change-log explorer below.
    await resultRow.getByRole('link', { name: /^c[a-z0-9]{20,}$/ }).click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    await page.getByRole('button', { name: /^Show \d+ changes?$/ }).click();
    await expect(page.getByRole('button', { name: 'Hide' })).toBeVisible();
    await signOut(page);

    // 2. Sign in as sysadmin, open /admin/change-log. Set Subject type to Receipt and Subject id to the receipt id.
    await signIn(page, 'sysadmin');
    await page.goto('/admin/change-log');
    await page.getByLabel('Subject type').selectOption('Receipt');
    await page.getByRole('textbox', { name: 'Subject id' }).fill(receiptId!);
    // Issuance writes two Receipt entries with the same reason (the receipt, then its PDF artifact);
    // the one carrying the number and amount is the receipt-creation entry.
    const entryRow = page
      .getByRole('row')
      .filter({ hasText: reason })
      .filter({ hasText: 'amountCents' });
    await expect(entryRow).toHaveCount(1);
    await expect(entryRow).toContainText(`Receipt (${receiptId})`);
    await expect(entryRow).toContainText('Party CFO');
    await expect(entryRow).toContainText(receiptNumber);
    await expect(entryRow).toContainText('"amountCents":5000');

    // Same facts from the API, which returns untruncated entries.
    const res = await page.request.get(`/api/change-log?subjectType=Receipt&subjectId=${receiptId}`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ actorName: string; reason: string; after: Record<string, unknown> }>;
    };
    const entry = body.data.find((e) => e.after?.['receiptNumber'] === receiptNumber);
    expect(entry).toBeDefined();
    expect(entry!.actorName).toBe('Party CFO');
    expect(entry!.reason).toBe(reason);
    expect(entry!.after['amountCents']).toBe(5000);
  });
});
