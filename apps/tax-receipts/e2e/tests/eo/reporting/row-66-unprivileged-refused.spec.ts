// spec: specs/eo-reporting.md
// seed: tests/seed.spec.ts

import { expect, test, type Page } from '@playwright/test';
import { signIn } from '../../helpers.js';

const URL = '/spaces/9503/PARTY/entity-reports';
const GENERATE_WARNING = 'Only the party CFO, a designate, bookkeeper, or filer may generate reports.';
const VIEW_WARNING = 'Your role cannot view generated reports.';

async function expectRefused(page: Page, csvUrl: string) {
  await page.goto(URL);
  await expect(page.getByRole('heading', { name: 'Entity reports' })).toBeVisible();
  await expect(page.getByText('Generate a report')).toBeVisible();
  await expect(page.getByText(GENERATE_WARNING)).toBeVisible();
  await expect(page.getByText(VIEW_WARNING)).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Download CSV' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mark sent' })).toHaveCount(0);

  // Fill a reason; Generate must stay disabled (never clicked).
  await page.getByRole('textbox', { name: 'Reason for generating (required)' }).fill('should not be allowed');
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();

  const response = await page.request.get(csvUrl);
  expect(response.status()).toBe(403);
  expect(await response.json()).toEqual({ error: 'not permitted to view entity reports' });
}

test.describe('Reporting', () => {
  test('Row 66: readonly and admin are refused the list, the CSV, and Generate', async ({ page }) => {
    const sfx = Date.now().toString(36);

    // 1. Precondition: obtain a report id as a privileged user (cfo, who holds View and Generate
    //    entity reports; the plan used sysadmin), then clear cookies and sign in as readonly.
    await signIn(page, 'cfo');
    await page.goto(URL);
    await expect(page.getByRole('heading', { name: 'Entity reports' })).toBeVisible();
    const csvLink = page.getByRole('link', { name: 'Download CSV' }).first();
    const noReports = page.getByText('No reports generated yet for this space.');
    await expect(csvLink.or(noReports)).toBeVisible();
    if (await noReports.isVisible()) {
      await page.getByRole('textbox', { name: 'Reason for generating (required)' }).fill(`E2E row 66 seed ${sfx}`);
      await page.getByRole('button', { name: 'Generate', exact: true }).click();
    }
    await expect(csvLink).toBeVisible();
    const href = await csvLink.getAttribute('href');
    expect(href).toMatch(/^\/api\/entity-reports\/[^/]+\/csv$/);
    // cfo can read the CSV.
    const cfoResponse = await page.request.get(href!);
    expect(cfoResponse.status()).toBe(200);
    expect(cfoResponse.headers()['content-type']).toContain('text/csv');

    await page.context().clearCookies();
    await signIn(page, 'readonly');

    // 2. Open /spaces/9503/PARTY/entity-reports as readonly.
    // 3. Fill the reason and check Generate stays disabled.
    // 4. Request the CSV URL directly: 403.
    await expectRefused(page, href!);

    // 5. Clear cookies, sign in as admin, and repeat the page checks, Generate check, and CSV request.
    await page.context().clearCookies();
    await signIn(page, 'admin');
    await expectRefused(page, href!);

    // 6. Clear cookies and request the same CSV URL with no session.
    await page.context().clearCookies();
    const anonymous = await page.request.get(href!);
    expect(anonymous.status()).toBe(401);
    expect(await anonymous.json()).toEqual({ error: 'authentication required' });
  });
});
