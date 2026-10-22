// spec: specs/eo-reporting.md
// seed: tests/seed.spec.ts

import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { signIn } from '../../helpers.js';

const ALL_HEADER =
  'Party_ID,Contributor_ID,Receipt_Number,Receipt_Status,Agency_Contribution,General_Meetings,Political_Entity_Type,Political_Entity,Contribution_Amount,Contribution_Type,Acceptance_Date,Receipt_Issuance_Date,Contribution_Period_ID,Contributor_Type,Contributor_Last_Name,Contributor_First_Name,Organization_Name,Contributor_Address,Contributor_City,Contributor_Province,Contributor_Postal_Code';

type Row = Record<string, string>;

/** Generate an ALL report on the open entity-reports page, download its CSV, and parse it. */
async function generateAndDownload(page: Page, reasonText: string, expectedRows: string) {
  const firstLink = page.locator('tbody tr').first().getByRole('link', { name: 'Download CSV' });
  const before = (await firstLink.count()) > 0 ? await firstLink.getAttribute('href') : null;

  const reason = page.getByRole('textbox', { name: 'Reason for generating (required)' });
  const generate = page.getByRole('button', { name: 'Generate', exact: true });
  await reason.fill(reasonText);
  await expect(generate).toBeEnabled();
  await generate.click();

  // The new report is the first row of the table.
  const newest = page.locator('tbody tr').first();
  await expect(newest.getByRole('link', { name: 'Download CSV' })).toBeVisible();
  await expect.poll(async () => newest.getByRole('link', { name: 'Download CSV' }).getAttribute('href')).not.toBe(before);
  await expect(newest.getByRole('cell', { name: 'ALL', exact: true })).toBeVisible();
  await expect(newest.getByRole('cell', { name: expectedRows, exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await newest.getByRole('link', { name: 'Download CSV' }).click();
  const download = await downloadPromise;
  const text = (await readFile(await download.path(), 'utf8')).replace(/^﻿/, '').replace(/"/g, '');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0]!;
  const names = header.split(',');
  const rows: Row[] = lines.slice(1).map((line) => {
    const cells = line.split(',');
    expect(cells).toHaveLength(21);
    return Object.fromEntries(names.map((h, i) => [h, cells[i] ?? '']));
  });
  return { header, rows };
}

function find(rows: Row[], last: string, first: string, amount: string) {
  return rows.filter(
    (r) =>
      r['Contributor_Last_Name'] === last &&
      r['Contributor_First_Name'] === first &&
      r['Contribution_Amount'] === amount,
  );
}

test.describe('Reporting', () => {
  test('Row 68: ALL report conforms to the spec (columns, statuses, agency flag, consolidated receipt)', async ({
    page,
  }) => {
    const sfx = Date.now().toString(36);

    // 1. Sign in as sysadmin; on /spaces/9503/PARTY/entity-reports generate an ALL report and download its CSV.
    await signIn(page, 'sysadmin');
    await page.goto('/spaces/9503/PARTY/entity-reports');
    await expect(page.getByRole('heading', { name: 'Entity reports' })).toBeVisible();
    const party = await generateAndDownload(page, `E2E row 68 party ${sfx}`, '9');
    expect(party.header).toBe(ALL_HEADER);
    expect(party.header.split(',').slice(-5)).toEqual([
      'Organization_Name',
      'Contributor_Address',
      'Contributor_City',
      'Contributor_Province',
      'Contributor_Postal_Code',
    ]);
    expect(party.rows).toHaveLength(9);
    const statuses = party.rows.map((r) => r['Receipt_Status']);
    expect(statuses).toEqual(expect.arrayContaining(['I', 'C', 'L']));

    const rory = find(party.rows, 'Rory', 'Reissued', '60.00');
    expect(rory).toHaveLength(2);
    expect(rory.map((r) => r['Receipt_Status']).sort()).toEqual(['C', 'I']);
    expect(rory[0]!['Receipt_Number']).not.toBe(rory[1]!['Receipt_Number']);

    const lena = find(party.rows, 'Lena', 'Lost', '45.00');
    expect(lena).toHaveLength(1);
    expect(lena[0]!['Receipt_Status']).toBe('L');

    const gita = find(party.rows, 'Gita', 'Goods', '80.00');
    expect(gita).toHaveLength(1);
    expect(gita[0]!['Contribution_Type']).toBe('GS');
    for (const r of party.rows) {
      if (r !== gita[0]) expect(r['Contribution_Type']).toBe('MO');
      expect(r['Contribution_Amount']).toMatch(/^\d+\.\d{2}$/);
      expect(r['Acceptance_Date']).toMatch(/^\d{8}$/);
      expect(r['Political_Entity_Type']).toBe('P');
      expect(r['Agency_Contribution']).toBe('N');
      expect(r['General_Meetings']).toBe('N');
    }
    const sam = find(party.rows, 'Sam', 'Split', '300.00');
    expect(sam).toHaveLength(1);
    expect(sam[0]!['Acceptance_Date']).toBe('03012029');

    // 2. Open the riding 121 CA space, fill the label and reason, generate, and download the CSV.
    await page.goto('/spaces/9503/CA/entity-reports?ridingNumber=121');
    await expect(page.getByText('Period 9503 · Riding 121 · Constituency association')).toBeVisible();
    // The label is empty and required on riding spaces.
    await page
      .getByRole('textbox', { name: 'Political entity label (as it should print on the file)' })
      .fill('Riding 121 CA');
    const ca = await generateAndDownload(page, `E2E row 68 CA ${sfx}`, '3');
    expect(ca.header).toBe(ALL_HEADER);
    expect(ca.rows).toHaveLength(3);
    for (const r of ca.rows) {
      expect(r['Political_Entity_Type']).toBe('A');
      expect(r['Political_Entity']).toBe('Riding 121 CA');
    }
    expect(find(ca.rows, 'Alex', 'Agency', '150.00')[0]!['Agency_Contribution']).toBe('Y');
    expect(find(ca.rows, 'Dee', 'Direct', '120.00')[0]!['Agency_Contribution']).toBe('N');
    expect(find(ca.rows, 'Sam', 'Split', '200.00')[0]!['Agency_Contribution']).toBe('Y');

    // 3. Open /spaces/9504/PARTY/entity-reports, fill the reason, generate, and download the CSV.
    await page.goto('/spaces/9504/PARTY/entity-reports');
    await expect(page.getByRole('heading', { name: 'Entity reports' })).toBeVisible();
    const p9504 = await generateAndDownload(page, `E2E row 68 9504 ${sfx}`, '1');
    expect(p9504.header).toBe(ALL_HEADER);
    expect(p9504.rows).toHaveLength(1);
    const chris = p9504.rows[0]!;
    expect(chris['Contributor_Last_Name']).toBe('Consolidating Chris');
    expect(chris['Contributor_First_Name']).toBe('');
    expect(chris['Contribution_Amount']).toBe('65.00');
    expect(chris['Acceptance_Date']).toBe('03102030');
    expect(chris['Receipt_Status']).toBe('I');
    expect(chris['Contribution_Type']).toBe('MO');
    expect(chris['Contribution_Period_ID']).toBe('9504');
    expect(chris['Contributor_ID']).toBe('910001');
  });
});
