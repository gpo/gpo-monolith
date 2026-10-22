// spec: specs/eo-general.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('General', () => {
  test('Row 2: Related records are linked across contribution, contributor, and payment', async ({ page }) => {
    // 1. Sign in as cfo and go to /contributions?periodId=9503&entityKind=PARTY
    await signIn(page, 'cfo');
    await page.goto('/contributions?periodId=9503&entityKind=PARTY');
    const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Split Sam' }) });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('cell', { name: '$300.00' })).toBeVisible();
    await expect(row.getByRole('cell', { name: '9503', exact: true })).toBeVisible();
    await expect(row.getByRole('cell', { name: 'PARTY', exact: true })).toBeVisible();
    // Plan expected "ISSUED"; the list shows lowercase "issued".
    await expect(row.getByRole('cell', { name: 'issued', exact: true })).toBeVisible();

    // 2. Click the 'Split Sam' donor link in that row
    await row.getByRole('link', { name: 'Split Sam' }).click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    await expect(page.getByRole('heading', { name: 'Contribution', level: 2 })).toBeVisible();

    await expect(page.getByText('Entered by hand')).toBeVisible();
    await expect(page.getByText('$500.00')).toBeVisible();
    await expect(page.getByText('Cheque', { exact: true })).toBeVisible();
    await expect(page.getByText('fixture-g4-3')).toBeVisible();
    await expect(page.getByText('Donor who paid')).toBeVisible();
    await expect(page.getByText('Split across 2 contributions:')).toBeVisible();

    const splitRows = page.getByRole('row').filter({ hasText: /this contribution|agency/ });
    await expect(splitRows.filter({ hasText: 'this contribution' })).toContainText('$300.00');
    await expect(splitRows.filter({ hasText: 'this contribution' })).toContainText('Party (province-wide)');
    await expect(splitRows.filter({ hasText: 'agency' })).toContainText('$200.00');
    await expect(splitRows.filter({ hasText: 'agency' })).toContainText('Constituency association, riding 121');
    await expect(splitRows.filter({ hasText: 'agency' }).getByRole('link', { name: 'Split Sam' })).toBeVisible();

    await expect(page.getByText('Individual, contributor id T33')).toBeVisible();
    await expect(page.getByText('$300.00').first()).toBeVisible();
    await expect(page.getByText('Party (province-wide)').first()).toBeVisible();
    const receiptRow = page.getByRole('row').filter({ hasText: /GPO-\d+/ });
    await expect(receiptRow).toContainText('ISSUED');
    await expect(receiptRow).toContainText('$300.00');

    // 3. Click the 'Split Sam' link under 'Donor' in the Contribution panel
    const donorLink = page
      .locator('div')
      .filter({ has: page.getByText('Individual, contributor id T33') })
      .getByRole('link', { name: 'Split Sam' })
      .last();
    await donorLink.click();
    await expect(page).toHaveURL(/\/contributors\/[^/]+$/);
    await expect(page.getByRole('heading', { name: 'Split Sam', level: 2 })).toBeVisible();
    await expect(page.getByText('Email: split.sam@g4.fixture.test')).toBeVisible();
    await expect(page.getByText('Contributor id: T33')).toBeVisible();

    const partyRow = page.getByRole('row').filter({ hasText: '$300.00' }).filter({ hasText: 'PARTY' });
    await expect(partyRow).toContainText('9503');
    await expect(partyRow).toContainText('ACTIVE');
    const caRow = page.getByRole('row').filter({ hasText: '$200.00' });
    await expect(caRow).toContainText('CA (riding 121)');
    await expect(caRow).toContainText('9503');
    await expect(caRow).toContainText('ACTIVE');

    // 4. Click the date link of the $300.00 row in the contributor's Contributions table
    await partyRow.getByRole('link').click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    await expect(page.getByRole('heading', { name: 'Contribution', level: 2 })).toBeVisible();
    await expect(page.getByText('$300.00').first()).toBeVisible();
  });
});
