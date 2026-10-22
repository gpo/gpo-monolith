// spec: specs/eo-reporting.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { signIn } from '../../helpers.js';

const S2P2_HEADER =
  'Party_ID,Contributor_ID,Political_Entity_Type,Political_Entity,Contribution_Period_ID,Contributor_Type,Contributor_Last_Name,Contributor_First_Name,Organization_Name,Contributor_Address,Contributor_City,Contributor_Province,Contributor_Postal_Code,Aggregate_Contribution_Amount';

test.describe('Reporting', () => {
  test('Row 69: S2P2 report conforms to the spec (over-$200 aggregate)', async ({ page }) => {
    const sfx = Date.now().toString(36);

    // 1. Sign in as sysadmin, open /spaces/9503/PARTY/entity-reports, choose S2P2, fill the reason, click Generate, and download the CSV from the newest row.
    await signIn(page, 'sysadmin');
    await page.goto('/spaces/9503/PARTY/entity-reports');
    await expect(page.getByRole('heading', { name: 'Entity reports' })).toBeVisible();
    await page.getByLabel('Report', { exact: true }).selectOption('S2P2 (over-$200 contributor aggregate)');
    const reason = page.getByRole('textbox', { name: 'Reason for generating (required)' });
    const generate = page.getByRole('button', { name: 'Generate', exact: true });
    await reason.fill(`E2E row 69 ${sfx}`);
    await expect(generate).toBeEnabled();
    await generate.click();

    const newestRow = page.locator('tbody tr').first();
    await expect(newestRow.getByRole('cell', { name: 'S2P2', exact: true })).toBeVisible();
    await expect(newestRow.getByRole('cell', { name: '2', exact: true })).toBeVisible();
    await expect(newestRow.getByRole('cell', { name: 'Clean', exact: true })).toBeVisible();

    const href = await newestRow.getByRole('link', { name: 'Download CSV' }).getAttribute('href');
    expect(href).toMatch(/^\/api\/entity-reports\/[^/]+\/csv$/);
    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);
    const text = (await response.text()).replace(/^﻿/, '').replace(/"/g, '');
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    const header = lines[0]!.split(',');
    expect(lines[0]).toBe(S2P2_HEADER);
    expect(header).toHaveLength(14);
    expect(header[header.length - 1]).toBe('Aggregate_Contribution_Amount');

    // 2. Parse the data rows.
    const dataLines = lines.slice(1);
    expect(dataLines).toHaveLength(2);
    const rows = dataLines.map((line) => {
      const cells = line.split(',');
      expect(cells).toHaveLength(14);
      return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
    });
    for (const r of rows) {
      expect(r['Contributor_Type']).toBe('P');
      expect(r['Political_Entity_Type']).toBe('P');
      expect(r['Political_Entity']).toBe('Green Party of Ontario');
      expect(r['Contribution_Period_ID']).toBe('9503');
    }
    const sam = rows.filter(
      (r) => r['Contributor_First_Name'] === 'Split' && r['Contributor_Last_Name'] === 'Sam',
    );
    expect(sam).toHaveLength(1);
    expect(sam[0]!['Aggregate_Contribution_Amount']).toBe('300.00');
    // 100 + 75 + 50 aggregated over three receipts.
    const theo = rows.filter(
      (r) => r['Contributor_First_Name'] === 'Threshold' && r['Contributor_Last_Name'] === 'Theo',
    );
    expect(theo).toHaveLength(1);
    expect(theo[0]!['Aggregate_Contribution_Amount']).toBe('225.00');
    // Nobody else is over $200 (Rory, Lena, Emma, Gita, and the 9503 CA donors are absent).
    for (const name of ['Rory', 'Lena', 'Emma', 'Gita', 'Alex', 'Dee']) {
      expect(rows.some((r) => r['Contributor_Last_Name'] === name)).toBe(false);
    }
  });
});
