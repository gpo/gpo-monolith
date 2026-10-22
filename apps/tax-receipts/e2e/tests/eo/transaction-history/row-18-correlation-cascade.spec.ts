// spec: specs/eo-transaction-history.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

type LogEntry = {
  subjectType: string;
  subjectId: string;
  reason: string;
  correlationId: string;
  actorUserId: string;
};

test.describe('Transaction History', () => {
  test('Row 18: A payment cascade shares one correlation id', async ({ page }) => {
    const sfx = Date.now().toString(36);
    const lastName = `Cascade${sfx}`;
    const createReason = `Row18c create ${sfx}`;
    const paymentReason = `Row18c payment ${sfx}`;

    // 1. Sign in as admin, add the contributor, then record a $25 payment in period 64.
    await signIn(page, 'admin');
    await page.goto('/contributors');
    await page.getByRole('button', { name: 'Add a contributor' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('First name').fill('Cora');
    await dialog.getByLabel('Last name').fill(lastName);
    await dialog.getByLabel('Street number').fill('10');
    await dialog.getByLabel('Street', { exact: true }).fill('Elm St');
    await dialog.getByLabel('City').fill('Toronto');
    await dialog.getByLabel('Postal code').fill('M5V 2T6');
    await dialog.getByLabel('Reason (required)').fill(createReason);
    const addButton = dialog.getByRole('button', { name: 'Add contributor' });
    await expect(addButton).toBeEnabled();
    await addButton.click();
    await expect(page).toHaveURL(/\/contributors\/[^/]+$/);
    const contactId = page.url().split('/').pop()!;

    await page.goto('/payments/new');
    await page.getByRole('textbox', { name: 'Donor who paid' }).fill(lastName);
    await page.getByRole('option', { name: new RegExp(lastName) }).click();
    await page.getByLabel('Amount ($)').first().fill('25');
    // Received on 2025-03-15 and an explicit period keep this out of the A1 work item
    // (the plan expected today's date).
    await page.getByRole('textbox', { name: 'Received on' }).fill('2025-03-15');
    await page.getByLabel('Period').selectOption('2025 General Election');
    await page.getByRole('textbox', { name: 'Reason (required)' }).fill(paymentReason);
    const savePayment = page.getByRole('button', { name: 'Save payment' });
    await expect(savePayment).toBeEnabled();
    await savePayment.click();
    await expect(page.getByRole('heading', { name: 'Payment recorded' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open the contribution' })).toBeVisible();

    // 2. Click 'Open the contribution', then click 'Show 2 changes' in Change history.
    await page.getByRole('link', { name: 'Open the contribution' }).click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    const contributionId = page.url().split('/').pop()!;
    await page.getByRole('button', { name: 'Show 2 changes' }).click();
    // The history here is a list of paragraphs, not a table as the plan implied.
    await expect(page.getByText(paymentReason, { exact: true })).toHaveCount(2);

    // 3. Read the change log API and compare correlation ids.
    const contributionRes = await page.request.get(`/api/change-log?subjectId=${contributionId}`);
    expect(contributionRes.ok()).toBeTruthy();
    const contributionEntries: LogEntry[] = (await contributionRes.json()).data;
    const contributionEntry = contributionEntries.find((e) => e.reason === paymentReason);
    expect(contributionEntry).toBeDefined();
    const correlationId = contributionEntry!.correlationId;
    expect(correlationId).toBeTruthy();

    const actorRes = await page.request.get(
      `/api/change-log?actorUserId=${contributionEntry!.actorUserId}`,
    );
    expect(actorRes.ok()).toBeTruthy();
    const actorEntries: LogEntry[] = (await actorRes.json()).data;
    const paymentEntry = actorEntries.find(
      (e) => e.subjectType === 'Payment' && e.reason === paymentReason,
    );
    expect(paymentEntry).toBeDefined();
    expect(paymentEntry!.correlationId).toBe(correlationId);

    const contactRes = await page.request.get(`/api/change-log?subjectId=${contactId}`);
    const contactEntries: LogEntry[] = (await contactRes.json()).data;
    const createEntry = contactEntries.find((e) => e.reason === createReason);
    expect(createEntry).toBeDefined();
    expect(createEntry!.correlationId).toBeTruthy();
    expect(createEntry!.correlationId).not.toBe(correlationId);

    // 4. Go to /admin/change-log and type the correlation id into 'Correlation id'.
    await page.goto('/admin/change-log');
    await page.getByLabel('Correlation id').fill(correlationId);
    const rows = page.getByRole('table').getByRole('row');
    await expect(rows.filter({ hasText: paymentReason })).toHaveCount(2);
    await expect(rows.filter({ hasText: createReason })).toHaveCount(0);

    // 5. With the correlation filter active, click 'Export CSV (for EO)'.
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV (for EO)' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('change-log-export.csv');
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const csv = Buffer.concat(chunks).toString('utf8');
    expect(csv).toContain(correlationId);
    expect(csv).toContain(paymentReason);
    expect(csv).not.toContain(createReason);
  });
});
