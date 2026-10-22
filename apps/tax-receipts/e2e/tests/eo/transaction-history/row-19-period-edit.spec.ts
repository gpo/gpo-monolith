// spec: specs/eo-transaction-history.md
// seed: tests/seed.spec.ts

import { test, expect, type Page } from '@playwright/test';
import { signIn } from '../../helpers.js';

async function savePeriod64(page: Page, endsAt: string, reason: string) {
  await page.getByRole('textbox', { name: 'Id (EO period id)' }).fill('64');
  await page.getByRole('textbox', { name: 'Name' }).fill('2025 General Election');
  await page.getByLabel('Kind').selectOption('GENERAL_ELECTION');
  await page.getByRole('textbox', { name: 'Starts at (UTC)' }).fill('2025-01-27T00:00');
  await page.getByRole('textbox', { name: 'Ends at (UTC)' }).fill(endsAt);
  await page.getByRole('textbox', { name: 'Reason (required, recorded in' }).fill(reason);
  const save = page.getByRole('button', { name: 'Save period' });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(
    page.getByText('Saved. Validation re-run against every mirrored contribution.'),
  ).toBeVisible();
}

test.describe('Transaction History', () => {
  test('Row 19: Audit on new records - a period edit is logged as a Period entry', async ({
    page,
  }) => {
    const sfx = Date.now().toString(36);
    const reason = `Row19 period ${sfx}`;
    const restoreReason = `Row19 period restore ${sfx}`;
    const row64 = page.getByRole('row').filter({ has: page.getByRole('cell', { name: '2025 General Election', exact: true }) });

    // 1. Sign in as sysadmin (admin@ cannot save periods). Go to /admin/periods.
    await signIn(page, 'sysadmin');
    await page.goto('/admin/periods');
    await expect(row64).toContainText('GENERAL_ELECTION');
    await expect(row64).toContainText('1/27/2025');
    await expect(row64).toContainText('5/28/2025');

    try {
      // 2. Fill the period form with Ends at 2025-05-29T00:00 and save.
      await savePeriod64(page, '2025-05-29T00:00', reason);
      await expect(row64).toContainText('5/29/2025');

      // 3. Go to /admin/change-log, choose Subject type 'Period', type '64' into 'Subject id'.
      await page.goto('/admin/change-log');
      await page.getByLabel('Subject type').selectOption('Period');
      await page.getByLabel('Subject id').fill('64');
      const entryRow = page.getByRole('row').filter({ hasText: reason });
      await expect(entryRow).toHaveCount(1);
      await expect(entryRow).toContainText('Period (64)');
      await expect(entryRow).toContainText('Sys Admin');

      const res = await page.request.get('/api/change-log?subjectType=Period&subjectId=64');
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      const entry = body.data.find((e: { reason: string }) => e.reason === reason);
      expect(entry).toBeTruthy();
      // Compare dates in the local time zone; the stored time of day carries the browser offset.
      const day = (iso: string) => new Date(iso).toLocaleDateString('en-CA');
      expect(day(entry.before.endsAt)).toBe('2025-05-28');
      expect(day(entry.after.endsAt)).toBe('2025-05-29');
    } finally {
      // 4. Restore: submit the same form with Ends at 2025-05-28T00:00.
      await page.goto('/admin/periods');
      await savePeriod64(page, '2025-05-28T00:00', restoreReason);
      await expect(row64).toContainText('5/28/2025');
    }

    await page.goto('/admin/change-log');
    await page.getByLabel('Subject type').selectOption('Period');
    await page.getByLabel('Subject id').fill('64');
    await expect(page.getByRole('row').filter({ hasText: restoreReason })).toHaveCount(1);
  });
});
