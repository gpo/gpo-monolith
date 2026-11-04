// spec: specs/eo-contributions.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { signIn, switchUser } from '../../helpers.js';

test.describe('Contributions', () => {
  test('Row 25: Entity column identifies party, association, campaign, and leadership contestant', async ({ page }) => {
    const contributionRow = (donor: string, amount: string, period: string) =>
      page
        .getByRole('row')
        .filter({ has: page.getByRole('link', { name: donor, exact: true }) })
        .filter({ hasText: amount })
        .filter({ hasText: period });

    // 1. Sign in as admin.
    await signIn(page, 'admin');
    await page.goto('/contributions');
    await expect(page.getByRole('heading', { name: 'Contributions', level: 2 })).toBeVisible();

    // 2. In the Contributions list, find the row Split Sam $300.00 (period 9503).
    const samRow = contributionRow('Split Sam', '$300.00', '9503');
    await expect(samRow.getByRole('cell').nth(6)).toHaveText('PARTY');
    await expect(samRow.getByRole('cell').nth(5)).toHaveText('—');

    // 3. Find the row Agency Alex $150.00 (period 9503).
    const alexRow = contributionRow('Agency Alex', '$150.00', '9503');
    await expect(alexRow.getByRole('cell').nth(6)).toHaveText('CA');
    await expect(alexRow.getByRole('cell').nth(5)).toHaveText('121');

    // 4. Find the row Leadership Lee $250.00 (period 9503).
    const leeRow = contributionRow('Leadership Lee', '$250.00', '9503');
    await expect(leeRow.getByRole('cell').nth(6)).toHaveText('LEADERSHIP: Jordan Rivers');

    // 5. Find the row By-Election Donor $50.00 (period 9501).
    const byElectionRow = contributionRow('By-Election Donor', '$50.00', '9501');
    await expect(byElectionRow.getByRole('cell').nth(6)).toHaveText('CAMPAIGN');
    await expect(byElectionRow.getByRole('cell').nth(5)).toHaveText('121');
    await expect(byElectionRow.getByRole('cell').nth(4)).toHaveText('9501');

    // 6. Use the Entity kind filter to choose 'Leadership contestant'.
    const entityKind = page.getByLabel('Entity kind');
    await expect(entityKind.locator('option')).toHaveText([
      '',
      'Party (province-wide)',
      'Constituency association',
      'Campaign',
      'Leadership contestant',
    ]);
    await entityKind.selectOption('Leadership contestant');
    await expect(page.getByRole('link', { name: 'Leadership Pat', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Leadership Lou', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Leadership Lee', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Leadership Import Donor', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Split Sam', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Agency Alex', exact: true })).toHaveCount(0);
    const bodyRows = page.locator('tbody').getByRole('row');
    // other tests add leadership contributions, so assert every row is one
    // rather than an exact count
    await expect(bodyRows.filter({ hasNotText: 'LEADERSHIP' })).toHaveCount(0);

    // 7. Open Leadership Lee (click the link in the row). Read the Recipient field of the Contribution card.
    await page.getByRole('link', { name: 'Leadership Lee', exact: true }).click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    await expect(page.getByText('Leadership contestant: Jordan Rivers')).toBeVisible();
    // The page has two Edit buttons (Payment card, then Contribution card); the second is the contribution's.
    const contributionEdit = page.getByRole('button', { name: 'Edit' }).nth(1);
    await expect(contributionEdit).toBeDisabled();
    await contributionEdit.hover();
    await expect(
      page.getByRole('tooltip', { name: 'This contribution backs an issued receipt; change it with Correct instead.' }),
    ).toBeVisible();

    // 8. Go back and open Leadership Pat (no issued receipt). Confirm Edit is enabled, then click it.
    await page.getByRole('link', { name: '← Back to list' }).click();
    await page.getByRole('link', { name: 'Leadership Pat', exact: true }).click();
    await expect(page.getByText('Leadership contestant: Jordan Rivers')).toBeVisible();
    const patEdit = page.getByRole('button', { name: 'Edit' }).nth(1);
    await expect(patEdit).toBeEnabled();
    await patEdit.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Edit contribution' })).toBeVisible();
    await expect(
      dialog.getByRole('combobox', { name: 'Recipient' }).getByRole('option', { name: 'Leadership contestant', selected: true }),
    ).toBeAttached();
    const picker = dialog.getByRole('textbox', { name: 'Leadership contestant' });
    await expect(picker).toHaveValue('Jordan Rivers (Fixture leadership contest (not real))');
    await expect(dialog.getByRole('button', { name: 'Save contribution' })).toBeDisabled();

    // 9. Click the contestant picker.
    await picker.click();
    await expect(
      page.getByRole('option', { name: 'Jordan Rivers (Fixture leadership contest (not real))' }),
    ).toBeVisible();
    await expect(
      page.getByRole('option', { name: 'Sam Okafor (Fixture leadership contest (not real))' }),
    ).toBeVisible();

    // 10. Click Cancel in the modal. Do not save.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Leadership contestant: Jordan Rivers')).toBeVisible();

    // 11. Sign in as sysadmin (admin@ lacks settings access, so its Admin menu has no
    //     'Leadership contestants'), navigate to Admin, and click 'Leadership contestants'
    //     in the side navigation.
    await switchUser(page, 'sysadmin');
    await page.goto('/admin');
    await page.getByRole('link', { name: 'Leadership contestants' }).click();
    await expect(page).toHaveURL(/\/admin\/leadership-contestants$/);
    for (const header of ['Contestant', 'Contest', 'Status']) {
      await expect(page.getByRole('columnheader', { name: header, exact: true })).toBeVisible();
    }
    for (const name of ['Jordan Rivers', 'Sam Okafor']) {
      const row = page.getByRole('row').filter({ hasText: name });
      await expect(row).toContainText('Fixture leadership contest (not real)');
      // The status renders as "active" (uppercased by CSS); match the cell exactly so "Make inactive" does not count.
      await expect(row.getByRole('cell', { name: 'active', exact: true })).toBeVisible();
    }
  });
});
