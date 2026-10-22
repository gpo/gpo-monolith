// spec: specs/eo-contributions.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Contributions', () => {
  test('Row 28: Split Sam payment is split across two entities with amounts', async ({ page }) => {
    // 1. Sign in as admin.
    await signIn(page, 'admin');

    // 2. On the Contributions list find the two 'Split Sam' rows ($300.00 PARTY and $200.00 CA riding 121) and open the $300.00 one.
    await page.goto('/contributions');
    const partyRow = page.getByRole('row', { name: /Split Sam.*\$300\.00.*PARTY/ });
    const caRow = page.getByRole('row', { name: /Split Sam.*\$200\.00.*121.*CA/ });
    await expect(partyRow).toBeVisible();
    await expect(caRow).toBeVisible();
    await partyRow.getByRole('link', { name: 'Split Sam' }).click();

    // The first "Amount" label belongs to the Payment card, the second to the Contribution card.
    const amountValue = (index: number) =>
      page
        .getByText('Amount', { exact: true })
        .nth(index)
        .locator('xpath=following-sibling::*[1]');

    await expect(page.getByText('Split across 2 contributions:')).toBeVisible();
    await expect(amountValue(0)).toHaveText('$500.00');
    await expect(amountValue(1)).toHaveText('$300.00');

    const splitRows = page.getByRole('table').filter({ hasText: 'this contribution' }).getByRole('row');
    const thisRow = splitRows.filter({ hasText: 'this contribution' });
    await expect(thisRow).toContainText('$300.00');
    await expect(thisRow).toContainText('Party (province-wide)');
    const otherRow = splitRows.filter({ has: page.getByRole('link', { name: 'Split Sam' }) });
    await expect(otherRow).toContainText('$200.00');
    await expect(otherRow).toContainText('Constituency association, riding 121');
    await expect(otherRow).toContainText('agency');

    const firstReceiptRow = page.getByRole('row', { name: /GPO-\d+/ });
    await expect(firstReceiptRow).toContainText('ISSUED');
    await expect(firstReceiptRow).toContainText('$300.00');
    const firstReceiptNumber = (await firstReceiptRow.getByRole('cell').first().innerText()).trim();

    // 3. Click the 'Split Sam' link in the split block.
    await otherRow.getByRole('link', { name: 'Split Sam' }).click();

    await expect(amountValue(0)).toHaveText('$500.00');
    await expect(amountValue(1)).toHaveText('$200.00');
    await expect(page.getByText('fixture-g4-3')).toBeVisible();
    await expect(page.getByText('Split across 2 contributions:')).toBeVisible();

    const caSplitRows = page.getByRole('table').filter({ hasText: 'this contribution' }).getByRole('row');
    const caThisRow = caSplitRows.filter({ hasText: 'this contribution' });
    await expect(caThisRow).toContainText('$200.00');
    await expect(caThisRow).toContainText('Constituency association, riding 121');
    await expect(caThisRow).toContainText('agency');
    const partyLinkRow = caSplitRows.filter({ has: page.getByRole('link', { name: 'Split Sam' }) });
    await expect(partyLinkRow).toContainText('$300.00');

    // Each half has its own receipt row with a different receipt number.
    const secondReceiptRow = page.getByRole('row', { name: /GPO-\d+/ });
    await expect(secondReceiptRow).toContainText('ISSUED');
    await expect(secondReceiptRow).toContainText('$200.00');
    const secondReceiptNumber = (await secondReceiptRow.getByRole('cell').first().innerText()).trim();
    expect(firstReceiptNumber).toMatch(/^GPO-\d+$/);
    expect(secondReceiptNumber).toMatch(/^GPO-\d+$/);
    expect(secondReceiptNumber).not.toBe(firstReceiptNumber);
  });
});
