// spec: specs/eo-reporting.md
// seed: tests/seed.spec.ts

import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Reporting', () => {
  test('Row 67: ALL and S2P2 are built from stored contribution records for 9503 PARTY', async ({
    page,
  }) => {
    const sfx = Date.now().toString(36);

    // 1. Sign in as sysadmin, open /spaces/9503/PARTY/entity-reports, fill the ALL reason and click Generate.
    await signIn(page, 'sysadmin');
    await page.goto('/spaces/9503/PARTY/entity-reports');
    await expect(page.getByRole('heading', { name: 'Entity reports' })).toBeVisible();
    const reason = page.getByRole('textbox', { name: 'Reason for generating (required)' });
    const generate = page.getByRole('button', { name: 'Generate', exact: true });
    await reason.fill(`E2E row 67 ALL ${sfx}`);
    await expect(generate).toBeEnabled();
    await generate.click();
    const allRow = page
      .locator('tbody tr')
      .filter({ has: page.getByRole('cell', { name: 'ALL', exact: true }) })
      .first();
    await expect(allRow.getByRole('cell', { name: '9', exact: true })).toBeVisible();
    const allHref = await allRow.getByRole('link', { name: 'Download CSV' }).getAttribute('href');
    expect(allHref).toMatch(/^\/api\/entity-reports\/[^/]+\/csv$/);

    // 2. Select S2P2, fill the reason, click Generate.
    await page.getByLabel('Report', { exact: true }).selectOption('S2P2 (over-$200 contributor aggregate)');
    await reason.fill(`E2E row 67 S2P2 ${sfx}`);
    await expect(generate).toBeEnabled();
    await generate.click();
    const newestRow = page.locator('tbody tr').first();
    await expect(newestRow.getByRole('cell', { name: 'S2P2', exact: true })).toBeVisible();
    await expect(newestRow.getByRole('cell', { name: '2', exact: true })).toBeVisible();
    await expect(newestRow.getByRole('cell', { name: 'Clean', exact: true })).toBeVisible();

    // 3. Download the ALL CSV from the ALL row you generated and parse it.
    // The newest ALL row is now below the S2P2 row; it is the one with the href captured above.
    const downloadPromise = page.waitForEvent('download');
    await page.locator(`a[href="${allHref}"]`).click();
    const download = await downloadPromise;
    const text = (await readFile(await download.path(), 'utf8')).replace(/^﻿/, '').replace(/"/g, '');
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    const header = lines[0]!.split(',');
    const rows = lines.slice(1).map((line) => {
      const cells = line.split(',');
      return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
    });
    expect(rows).toHaveLength(9);
    for (const r of rows) {
      expect(r['Receipt_Number']).toMatch(/^GPO-\d+$/);
      expect(r['Contribution_Period_ID']).toBe('9503');
      expect(r['Political_Entity']).toBe('Green Party of Ontario');
    }
    const theo = rows.filter(
      (r) => r['Contributor_First_Name'] === 'Threshold' && r['Contributor_Last_Name'] === 'Theo',
    );
    expect(theo).toHaveLength(3);
    expect(theo.map((r) => r['Contribution_Amount']).sort()).toEqual(['100.00', '50.00', '75.00']);

    // 4. Read the Status cell of the ALL row this scenario just generated.
    await expect(allRow.getByRole('cell', { name: 'Clean', exact: true })).toBeVisible();
  });
});
