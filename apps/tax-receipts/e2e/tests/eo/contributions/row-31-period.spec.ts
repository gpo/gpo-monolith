// spec: specs/eo-contributions.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Contributions', () => {
  test('Row 31: Contribution period on the detail and as a list filter', async ({ page }) => {
    const EO_PERIOD = 'Fixture — EO evaluation (not a real EO period)';
    const BY_ELECTION_PERIOD = 'Fixture by-election (not a real EO period)';
    const periodCells = page.locator('tbody tr td:nth-child(5)');
    const alexLink = page.getByRole('link', { name: 'Agency Alex' });
    const byElectionLink = page.getByRole('link', { name: 'By-Election Donor' });
    // Detail-page values sit in the element right after their label paragraph.
    const detailValue = (label: string) =>
      page.getByText(label, { exact: true }).locator('xpath=following-sibling::*[1]');

    // 1. Sign in as admin.
    await signIn(page, 'admin');

    // 2. Open Contributions and read the Period column for Agency Alex and By-Election Donor.
    await page.getByRole('banner').getByRole('link', { name: 'Contributions' }).click();
    await expect(page.getByRole('heading', { name: 'Contributions' })).toBeVisible();
    const alexRow = page.getByRole('row').filter({ has: alexLink });
    await expect(alexRow.getByRole('cell', { name: '9503', exact: true })).toBeVisible();
    const byElectionRow = page.getByRole('row').filter({ has: byElectionLink });
    await expect(byElectionRow.getByRole('cell', { name: '9501', exact: true })).toBeVisible();

    // 3. Open the Agency Alex contribution.
    await alexLink.click();
    await expect(page.getByRole('heading', { name: 'Contribution', exact: true })).toBeVisible();
    await expect(detailValue('Period')).toHaveText(EO_PERIOD);

    // 4. Go back, open By-Election Donor ($50.00, period 9501).
    await page.getByRole('link', { name: '← Back to list' }).click();
    await byElectionLink.click();
    await expect(detailValue('Period')).toHaveText(BY_ELECTION_PERIOD);
    await expect(detailValue('Recipient')).toHaveText('Campaign, riding 121');

    // 5. Go back to Contributions and use the Period filter: choose the EO evaluation fixture period.
    await page.getByRole('link', { name: '← Back to list' }).click();
    await page.getByRole('textbox', { name: 'Period' }).click();
    await page.getByRole('option', { name: EO_PERIOD }).click();
    await expect(byElectionLink).toBeHidden();
    await expect(alexLink).toBeVisible();
    await expect(page.getByRole('link', { name: 'Direct Dee' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Goods Gita' })).toBeVisible();
    const cells9503 = await periodCells.allTextContents();
    expect(cells9503.length).toBeGreaterThan(0);
    for (const text of cells9503) expect(text).toBe('9503');

    // 6. Change the Period filter to the by-election fixture period.
    await page.getByRole('textbox', { name: 'Period' }).click();
    await page.getByRole('option', { name: BY_ELECTION_PERIOD }).click();
    await expect(alexLink).toBeHidden();
    await expect(byElectionLink).toBeVisible();
    await expect(page.getByRole('link', { name: 'Campaign Cam' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Rambling Randy' })).toBeVisible();
    const cells9501 = await periodCells.allTextContents();
    expect(cells9501.length).toBeGreaterThan(0);
    for (const text of cells9501) expect(text).toBe('9501');
  });
});
