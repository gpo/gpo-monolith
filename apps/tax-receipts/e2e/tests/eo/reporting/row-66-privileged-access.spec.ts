// spec: specs/eo-reporting.md
// seed: tests/seed.spec.ts

import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { signIn } from '../../helpers.js';

const ALL_HEADER =
  'Party_ID,Contributor_ID,Receipt_Number,Receipt_Status,Agency_Contribution,General_Meetings,Political_Entity_Type,Political_Entity,Contribution_Amount,Contribution_Type,Acceptance_Date,Receipt_Issuance_Date,Contribution_Period_ID,Contributor_Type,Contributor_Last_Name,Contributor_First_Name,Organization_Name,Contributor_Address,Contributor_City,Contributor_Province,Contributor_Postal_Code';

test.describe('Reporting', () => {
  test('Row 66: privileged user lists, generates, and downloads reports', async ({
    page,
    browser,
    baseURL,
  }) => {
    const sfx = Date.now().toString(36);

    // 1. Sign in as sysadmin and open /spaces/9503/PARTY/entity-reports.
    await signIn(page, 'sysadmin');
    await page.goto('/spaces/9503/PARTY/entity-reports');
    await expect(page.getByRole('heading', { name: 'Entity reports' })).toBeVisible();
    await expect(page.getByText('Period 9503 · Party (province-wide)')).toBeVisible();
    await expect(page.getByText('Generate a report')).toBeVisible();
    await expect(page.getByText('Only the party CFO, a designate, bookkeeper, or filer may generate reports.')).toBeHidden();
    const reason = page.getByRole('textbox', { name: 'Reason for generating (required)' });
    const generate = page.getByRole('button', { name: 'Generate', exact: true });
    await expect(generate).toBeDisabled();

    // 2. Fill the reason, confirm Generate is enabled, then click it.
    await reason.fill(`E2E row 66 ${sfx}`);
    await expect(generate).toBeEnabled();
    await generate.click();
    const newestRow = page.locator('tbody tr').first();
    await expect(newestRow.getByRole('cell', { name: 'ALL', exact: true })).toBeVisible();
    await expect(newestRow.getByRole('cell', { name: '9', exact: true })).toBeVisible();
    const csvLink = newestRow.getByRole('link', { name: 'Download CSV' });
    await expect(csvLink).toBeVisible();
    await expect(newestRow.getByRole('button', { name: 'Mark sent' })).toBeVisible();
    const href = await csvLink.getAttribute('href');
    expect(href).toMatch(/^\/api\/entity-reports\/[^/]+\/csv$/);

    // 3. Click 'Download CSV' on that row and capture the download.
    const downloadPromise = page.waitForEvent('download');
    await csvLink.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^ALL-period9503-.*\.csv$/);
    const path = await download.path();
    const text = (await readFile(path, 'utf8')).replace(/^﻿/, '').replace(/"/g, '');
    const firstLine = text.split(/\r?\n/)[0];
    expect(firstLine).toBe(ALL_HEADER);

    // 4. In a fresh context sign in as cfo and open the same URL.
    // (Not run live: the MCP session has a single page.)
    const context = await browser.newContext({ baseURL });
    try {
      const cfoPage = await context.newPage();
      await signIn(cfoPage, 'cfo');
      await cfoPage.goto('/spaces/9503/PARTY/entity-reports');
      await expect(cfoPage.getByRole('heading', { name: 'Entity reports' })).toBeVisible();
      const cfoLink = cfoPage.locator(`a[href="${href}"]`);
      await expect(cfoLink).toBeVisible();
      const response = await cfoPage.request.get(href!);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('text/csv');
    } finally {
      await context.close();
    }
  });
});
