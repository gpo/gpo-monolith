// spec: specs/eo-contributions.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Contributions', () => {
  test('Row 26: Agency contribution flag on fixtures, list column, and filter', async ({ page }) => {
    const rowFor = (donor: string, amount: string) =>
      page.getByRole('row').filter({ hasText: donor }).filter({ hasText: amount });
    const recipientOf = () =>
      page.getByRole('main').locator('p', { hasText: /^Recipient$/ }).locator('..');
    const receivedByOf = () =>
      page.getByRole('main').locator('p', { hasText: /^Received by$/ }).locator('..');

    // 1. Sign in as admin.
    await signIn(page, 'admin');

    // 2. Open Contributions, then open the Agency Alex $150.00 row.
    await page.getByRole('banner').getByRole('link', { name: 'Contributions' }).click();
    await expect(page.getByRole('heading', { name: 'Contributions' })).toBeVisible();
    await rowFor('Agency Alex', '$150.00').getByRole('link', { name: 'Agency Alex' }).click();
    await expect(page.getByRole('heading', { name: 'Contribution', exact: true })).toBeVisible();
    await expect(recipientOf()).toContainText('Constituency association, riding 121');
    const badge = recipientOf().getByText('agency', { exact: true });
    await expect(badge).toBeVisible();
    await expect(receivedByOf()).toContainText('GPO (party office, central)');

    // 3. Hover the 'agency' badge.
    await badge.hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toContainText(
      'An agency contribution is one the party (GPO) received on behalf of another entity',
    );
    await expect(tooltip).toContainText('it files as Agency_Contribution = Y in the ALL report.');

    // 4. Go back and open the Direct Dee $120.00 row.
    await page.getByRole('link', { name: '← Back to list' }).click();
    await rowFor('Direct Dee', '$120.00').getByRole('link', { name: 'Direct Dee' }).click();
    await expect(page.getByRole('heading', { name: 'Contribution', exact: true })).toBeVisible();
    await expect(recipientOf()).toContainText('Constituency association, riding 121');
    await expect(recipientOf().getByText('agency', { exact: true })).toHaveCount(0);
    await expect(receivedByOf()).toContainText('Constituency association');
    await expect(receivedByOf()).not.toContainText('GPO');

    // 5. Go back and open the Leadership Lou $100.00 row.
    await page.getByRole('link', { name: '← Back to list' }).click();
    await rowFor('Leadership Lou', '$100.00').getByRole('link', { name: 'Leadership Lou' }).click();
    await expect(page.getByRole('heading', { name: 'Contribution', exact: true })).toBeVisible();
    await expect(recipientOf()).toContainText('Leadership contestant: Sam Okafor');
    await expect(recipientOf().getByText('agency', { exact: true })).toBeVisible();

    // 6. On the Contributions list, confirm the Agency column.
    await page.getByRole('link', { name: '← Back to list' }).click();
    await expect(rowFor('Agency Alex', '$150.00').getByText('agency', { exact: true })).toBeVisible();
    const deeRow = rowFor('Direct Dee', '$120.00');
    await expect(deeRow.getByText('ENTITY', { exact: true })).toBeVisible();
    await expect(deeRow.getByText('agency', { exact: true })).toHaveCount(0);
    await expect(deeRow.getByRole('cell', { name: '—', exact: true }).first()).toBeVisible();
    await expect(rowFor('Leadership Lou', '$100.00').getByText('agency', { exact: true })).toBeVisible();

    // 7. Click 'Show advanced filters' and set 'Agency contribution' to 'Agency only'.
    await page.getByRole('button', { name: 'Show advanced filters' }).click();
    await page.getByLabel('Agency contribution').selectOption('Agency only');
    await expect(rowFor('Direct Dee', '$120.00')).toHaveCount(0);
    await expect(rowFor('Agency Alex', '$150.00')).toBeVisible();
    await expect(rowFor('Leadership Lou', '$100.00')).toBeVisible();
    await expect(rowFor('Leadership Pat', '$75.00')).toBeVisible();
    await expect(rowFor('Split Sam', '$200.00')).toBeVisible();
    const bodyRows = page.locator('tbody tr');
    const total = await bodyRows.count();
    expect(total).toBeGreaterThan(0);
    for (let i = 0; i < total; i++) {
      await expect(bodyRows.nth(i).getByText('agency', { exact: true })).toBeVisible();
    }

    // 8. Change 'Agency contribution' to 'Not agency'.
    await page.getByLabel('Agency contribution').selectOption('Not agency');
    await expect(rowFor('Direct Dee', '$120.00')).toBeVisible();
    await expect(rowFor('Agency Alex', '$150.00')).toHaveCount(0);
    await expect(page.locator('tbody tr').getByText('agency', { exact: true })).toHaveCount(0);
  });
});
