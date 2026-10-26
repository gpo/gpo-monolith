// spec: specs/eo-issue-tax-receipt.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { changeField, openChangeEntryWithField, pdfTextFromBuffer, signIn } from '../../helpers.js';
import { addContributor, addPayment, createPeriod, issueSpace, newSuffix, signOut } from './recipe.js';

test.describe('Issue Tax Receipt: receipt records and audit', () => {
  test('Row 45: Date and time the receipt was generated', async ({ page }) => {
    const sfx = newSuffix();
    const reason = `E2E issue ${sfx}`;

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

    // 1. Record t0 = Date.now(), run Recipe R1 to R4 with one payment, record t1 = Date.now().
    //    (R1 to R3 ran above; the timestamps bracket the issuance itself, which is all that writes the entry.)
    await signIn(page, 'cfo');
    const t0 = Date.now();
    const utcBefore = new Date(t0).toISOString().slice(0, 10);
    const { receiptNumbers } = await issueSpace(page, periodId, { reason });
    const t1 = Date.now();
    const utcAfter = new Date(t1).toISOString().slice(0, 10);
    await expect(page.getByText('1 issued, 0 failed.')).toBeVisible();
    expect(receiptNumbers).toHaveLength(1);
    const receiptNumber = receiptNumbers[0]!;
    const resultRow = page.getByRole('row').filter({ hasText: receiptNumber });
    const href = (await resultRow.getByRole('link', { name: 'View PDF' }).getAttribute('href'))!;
    const receiptId = href.match(/^\/api\/receipts\/([^/]+)\/pdf$/)?.[1];
    expect(receiptId).toBeTruthy();

    // 2. On the contribution page read the receipt row's issue date; as sysadmin open /admin/change-log
    //    filtered by Subject type Receipt and the receipt id.
    // The PDF prints 'Issue Date: <today UTC>' (allow a run straddling midnight UTC).
    const response = await page.request.get(href);
    expect(response.status()).toBe(200);
    const text = await pdfTextFromBuffer(await response.body());
    const printed = /Issue Date: (\d{4}-\d{2}-\d{2})/.exec(text)?.[1];
    expect([utcBefore, utcAfter]).toContain(printed);

    // The row's issue date is today's date, locale formatted by the browser (accept a day either side
    // for the time zone and midnight).
    await resultRow.getByRole('link', { name: /^c[a-z0-9]{20,}$/ }).click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    const acceptable = await page.evaluate(() =>
      [-1, 0, 1].map((d) => new Date(Date.now() + d * 86_400_000).toLocaleDateString()),
    );
    const receiptRow = page.getByRole('row').filter({ has: page.getByText(/^GPO-00\d{6}$/) });
    await expect(receiptRow).toBeVisible();
    const rowText = await receiptRow.innerText();
    expect(acceptable.some((d) => rowText.includes(d))).toBe(true);
    await signOut(page);

    await signIn(page, 'sysadmin');
    await page.goto('/admin/change-log');
    await page.getByLabel('Subject type').selectOption('Receipt');
    await page.getByRole('textbox', { name: 'Subject id' }).fill(receiptId!);
    // Issuance writes two Receipt entries with the same reason, both summarized as "Created";
    // the one with a receiptNumber field is the receipt-creation entry.
    const entryRows = page
      .getByRole('row')
      .filter({ hasText: reason })
      .filter({ has: page.getByRole('cell', { name: 'Created', exact: true }) });
    await expect(entryRows).toHaveCount(2);
    const entryDialog = await openChangeEntryWithField(page, entryRows, 'receiptNumber');
    await expect(changeField(entryDialog, 'receiptNumber')).toContainText(receiptNumber);

    // The dialog's 'At' is rendered with toLocaleString: it must be a parseable time inside [t0, t1].
    const dialogText = await entryDialog.innerText();
    const atText = /\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2}\s?[AP]M/.exec(dialogText)?.[0];
    expect(atText).toBeDefined();
    const shown = Date.parse(atText!);
    // The UI string has one-second resolution, so allow a few seconds of slack either side.
    expect(shown).toBeGreaterThanOrEqual(t0 - 5_000);
    expect(shown).toBeLessThanOrEqual(t1 + 5_000);

    // Same from the API, which returns the full-precision timestamp.
    const res = await page.request.get(`/api/change-log?subjectType=Receipt&subjectId=${receiptId}`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ at: string; reason: string; after: Record<string, unknown> }>;
    };
    const entry = body.data.find((e) => e.after?.['receiptNumber'] === receiptNumber);
    expect(entry).toBeDefined();
    const at = Date.parse(entry!.at);
    expect(at).toBeGreaterThanOrEqual(t0 - 5_000);
    expect(at).toBeLessThanOrEqual(t1 + 5_000);
  });
});
