// spec: specs/eo-validation.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Validation and Controls', () => {
  test('Row 40: A resolved work item shows its resolution note and the correction\'s change-log entries share a correlation id', async ({ page }) => {
    const sfx = Date.now().toString(36);
    const lastName = `Trail${sfx}`;
    const donor = `Audit ${lastName}`;

    // 1. Sign in as admin.
    await signIn(page, 'admin');

    // 2. Create the contributor with the full BC address and the payment; open the contribution and record its id.
    await page.goto('/payments/new');
    await page.getByRole('button', { name: 'Not on file? Add a new contributor' }).click();
    const addDialog = page.getByRole('dialog');
    await addDialog.getByRole('textbox', { name: 'First name' }).fill('Audit');
    await addDialog.getByRole('textbox', { name: 'Last name' }).fill(lastName);
    await addDialog.getByRole('textbox', { name: 'Street number' }).fill('456');
    await addDialog.getByRole('textbox', { name: 'Street', exact: true }).fill('Robson St');
    await addDialog.getByRole('textbox', { name: 'City' }).fill('Vancouver');
    await addDialog.getByLabel('Province').selectOption('BC');
    await addDialog.getByRole('textbox', { name: 'Postal code' }).fill('V6B 1A1');
    await addDialog.getByRole('textbox', { name: 'Reason (required)' }).fill(`e2e audit trail setup ${sfx}`);
    const addButton = addDialog.getByRole('button', { name: 'Add contributor' });
    await expect(addButton).toBeEnabled();
    await addButton.click();
    await expect(addDialog).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Donor who paid' })).toHaveValue(donor);

    await page.getByRole('textbox', { name: 'Amount ($)' }).first().fill('50');
    await page.getByRole('textbox', { name: 'Received on' }).fill('2025-03-15');
    await page.getByRole('textbox', { name: 'Reason (required)' }).fill(`e2e audit trail payment ${sfx}`);
    const savePayment = page.getByRole('button', { name: 'Save payment' });
    await expect(savePayment).toBeEnabled();
    await savePayment.click();
    await page.getByRole('link', { name: 'Open the contribution' }).click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    const contributionId = new URL(page.url()).pathname.split('/').pop()!;
    const b1Item = page.getByRole('row').filter({ hasText: "Donor's address is out of province (B1)" });
    const c3Item = page.getByRole('row').filter({ hasText: 'Postal code is malformed or outside Ontario (C3)' });
    await expect(b1Item).toContainText('OPEN');
    await expect(c3Item).toContainText('OPEN');

    // 3. Resolve one item by exception first: the C3 row in the work queue.
    await page.goto('/work-queue');
    const queueRow = (code: string) =>
      page.getByRole('row').filter({ hasText: donor }).filter({ hasText: code });
    await queueRow('(C3)').getByRole('button', { name: 'Exception' }).click();
    await queueRow('(C3)').getByRole('textbox', { name: 'Exception reason' }).fill('e2e postal code reviewed');
    const confirm = queueRow('(C3)').getByRole('button', { name: 'Confirm' });
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(queueRow('(C3)')).toContainText('EXCEPTION');
    await expect(queueRow('(C3)')).toContainText('e2e postal code reviewed');

    // 4. Back on the contribution, run Correct > Refund with Reason 'e2e audit trail refund'.
    const refundReason = `e2e audit trail refund ${sfx}`;
    await page.goto(`/contributions/${contributionId}`);
    await page.getByRole('button', { name: 'Correct', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Action').selectOption('Refund');
    await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill(refundReason);
    await dialog.getByRole('button', { name: 'Preview cascade' }).click();
    const commit = dialog.getByRole('button', { name: 'Commit correction' });
    await expect(commit).toBeEnabled();
    await commit.click();
    await expect(dialog.getByText('Correction committed')).toBeVisible();

    // 5. Go to /work-queue and read the B1 row.
    await page.goto('/work-queue');
    const b1Row = queueRow('(B1)');
    await expect(b1Row).toHaveCount(1);
    await expect(b1Row).toContainText('RESOLVED');
    await expect(b1Row).toContainText(`closed by a correction: ${contributionId} is now REFUNDED`);

    // 6. Read the correlation id from GET /api/change-log?subjectId=<contribution id>.
    const response = await page.request.get(`/api/change-log?subjectId=${contributionId}`);
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as {
      data: { reason: string; correlationId: string; after: { status?: string } | null }[];
    };
    const creation = body.data.find((e) => e.reason === `e2e audit trail payment ${sfx}`);
    const refund = body.data.find((e) => e.reason === refundReason);
    expect(creation).toBeDefined();
    expect(refund).toBeDefined();
    expect(refund!.after).toEqual({ status: 'REFUNDED' });
    expect(creation!.correlationId).not.toBe(refund!.correlationId);
    const correlationId = refund!.correlationId;

    // 7. Open /admin/change-log and filter by that correlation id.
    await page.goto('/admin/change-log');
    await page.getByRole('textbox', { name: 'Correlation id' }).fill(correlationId);
    const contributionRow = page.getByRole('row').filter({ hasText: `Contribution (${contributionId})` });
    await expect(contributionRow).toHaveCount(1);
    await expect(contributionRow).toContainText(refundReason);
    await expect(contributionRow).toContainText('"status":"ACTIVE"');
    await expect(contributionRow).toContainText('"status":"REFUNDED"');
    const paymentRow = page.getByRole('row').filter({ hasText: /Payment \(/ });
    await expect(paymentRow).toHaveCount(1);
    await expect(paymentRow).toContainText(refundReason);
    await expect(paymentRow).toContainText('"state":"RECEIVED"');
    await expect(paymentRow).toContainText('"state":"REFUNDED"');
    const workItemRow = page.getByRole('row').filter({ hasText: /WorkItem \(/ });
    await expect(workItemRow).toHaveCount(1);
    await expect(workItemRow).toContainText(refundReason);
    await expect(workItemRow).toContainText('"status":"OPEN"');
    await expect(workItemRow).toContainText('"status":"RESOLVED"');

    // 8. Clear the Correlation id box and filter by the contribution's Subject id instead.
    await page.getByRole('textbox', { name: 'Correlation id' }).fill('');
    await page.getByRole('textbox', { name: 'Subject id' }).fill(contributionId);
    await expect(page.getByRole('row').filter({ hasText: `Contribution (${contributionId})` })).toHaveCount(2);
    await expect(page.getByRole('row').filter({ hasText: /Payment \(|WorkItem \(/ })).toHaveCount(0);
    await expect(page.getByRole('row').filter({ hasText: `e2e audit trail payment ${sfx}` })).toHaveCount(1);
    await expect(page.getByRole('row').filter({ hasText: refundReason })).toHaveCount(1);
  });
});
