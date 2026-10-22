// spec: specs/eo-validation.md
// seed: tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import { signIn } from '../../helpers.js';

test.describe('Validation and Controls', () => {
  test('Row 34: Work queue identifies the Morgan Ellis and Morgan Elis duplicate contributors (B4)', async ({ page }) => {
    // 1. Sign in as admin. Mutates: nothing.
    await signIn(page, 'admin');

    // 2. Go to /work-queue and find rows for 'Morgan Ellis' and 'Morgan Elis'.
    await page.goto('/work-queue');
    await expect(page.getByRole('heading', { name: 'Work queue' })).toBeVisible();
    const ellisRow = page.getByRole('row').filter({ hasText: /Morgan Ellis/ }).filter({ hasText: '(B4)' });
    const elisRow = page.getByRole('row').filter({ hasText: /Morgan Elis/ }).filter({ hasText: '(B4)' });
    for (const row of [ellisRow, elisRow]) {
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('Possible duplicate donor record');
      await expect(row).toContainText('OPEN');
    }

    // 3. Open the Contribution link of the 'Morgan Ellis' row, then of the 'Morgan Elis' row.
    await ellisRow.getByRole('link', { name: 'Contribution' }).click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    await expect(page.getByText('$40.00').first()).toBeVisible();
    await expect(page.getByText('3/15/2026').first()).toBeVisible();
    await expect(page.getByText('Party (province-wide)')).toBeVisible();
    const ellisWork = page.getByRole('row').filter({ hasText: 'Possible duplicate donor record (B4)' });
    await expect(ellisWork).toContainText('OPEN');

    await page.goto('/work-queue');
    await expect(elisRow).toHaveCount(1);
    await elisRow.getByRole('link', { name: 'Contribution' }).click();
    await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
    await expect(page.getByText('$60.00').first()).toBeVisible();
    await expect(page.getByText('8/15/2026').first()).toBeVisible();
    await expect(page.getByText('Party (province-wide)')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Possible duplicate donor record (B4)' })).toContainText('OPEN');

    // 4. Go to /contributors, type 'morgan.ellis@fixture.test' into the search box.
    await page.goto('/contributors');
    await page.getByPlaceholder('Name or email (two letters or more)').fill('morgan.ellis@fixture.test');
    const ellisContributor = page.getByRole('row').filter({ hasText: 'Morgan Ellis' });
    const elisContributor = page.getByRole('row').filter({ hasText: 'Morgan Elis' });
    await expect(ellisContributor).toHaveCount(1);
    await expect(elisContributor).toHaveCount(1);
    await expect(ellisContributor).toContainText('morgan.ellis@fixture.test');
    await expect(elisContributor).toContainText('morgan.ellis@fixture.test');
  });
});
