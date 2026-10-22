// spec: specs/eo-validation.md
// seed: tests/seed.spec.ts

import { test, expect } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Validation and Controls', () => {
  test("Row 36: Work queue identifies Double Dana's two $50 PARTY contributions as possible duplicates (A6)", async ({
    page,
  }) => {
    // 1. Sign in as admin.
    await signIn(page, 'admin');

    // 2. Go to /work-queue and find the rows with Donor 'Double Dana'.
    await page.goto('/work-queue');
    await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
    const rows = page.getByRole('row').filter({ hasText: 'Double Dana' }).filter({ hasText: '(A6)' });
    await expect(rows).toHaveCount(2);
    for (const row of await rows.all()) {
      await expect(row).toContainText('Possible duplicate contribution');
      await expect(row).toContainText('OPEN');
    }

    // 3. Open each row's Contribution link and check the Payment and Contribution cards.
    const hrefs: string[] = [];
    for (const link of await rows.getByRole('link', { name: 'Contribution' }).all()) {
      const href = await link.getAttribute('href');
      expect(href).toMatch(/^\/contributions\/.+/);
      hrefs.push(href!);
    }
    expect(new Set(hrefs).size).toBe(2);

    const received: string[] = [];
    for (const href of hrefs) {
      await page.goto(href);
      await expect(page.getByText('Party (province-wide)')).toBeVisible();
      await expect(page.getByText('$50.00').first()).toBeVisible();
      await expect(page.getByText('Possible duplicate contribution')).toBeVisible();
      const acceptedOn = (await page.getByText('Accepted on', { exact: true }).locator('xpath=following-sibling::*[1]').innerText()).trim();
      const receivedOn = (await page.getByText('Received on', { exact: true }).locator('xpath=following-sibling::*[1]').innerText()).trim();
      expect(acceptedOn).toBe(receivedOn);
      received.push(acceptedOn);
    }
    expect([...received].sort()).toEqual(['5/1/2026', '5/2/2026']);
  });
});
