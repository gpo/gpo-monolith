// spec: specs/eo-validation.md
// seed: tests/seed.spec.ts

import { expect, test, type Page } from '@playwright/test';
import { signIn } from '../../helpers.js';

async function openAddContributorDialog(page: Page) {
  await page.goto('/payments/new');
  await page.getByRole('button', { name: 'Not on file? Add a new contributor' }).click();
  return page.getByRole('dialog');
}

async function fillContributor(
  dialog: ReturnType<Page['getByRole']>,
  first: string,
  last: string,
  email: string,
  streetNumber: string,
) {
  await dialog.getByRole('textbox', { name: 'First name' }).fill(first);
  await dialog.getByRole('textbox', { name: 'Last name' }).fill(last);
  await dialog.getByRole('textbox', { name: 'Email' }).fill(email);
  await dialog.getByRole('textbox', { name: 'Street number' }).fill(streetNumber);
  await dialog.getByRole('textbox', { name: 'Street', exact: true }).fill('Queen St');
  await dialog.getByRole('textbox', { name: 'City' }).fill('Toronto');
  await dialog.getByRole('textbox', { name: 'Postal code' }).fill('M5V 2T6');
  await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill('e2e b4');
}

async function savePaymentAndOpen(page: Page, amount: string, receivedOn: string) {
  await page.getByRole('textbox', { name: 'Amount ($)' }).first().fill(amount);
  await page.getByRole('textbox', { name: 'Received on' }).fill(receivedOn);
  await page.getByRole('textbox', { name: 'Reason (required)' }).fill('e2e b4');
  const save = page.getByRole('button', { name: 'Save payment' });
  await expect(save).toBeEnabled();
  await save.click();
  await page.getByRole('link', { name: 'Open the contribution' }).click();
  await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
}

test.describe('Validation and Controls', () => {
  test("Row 34: Live: two contributors sharing an email raise B4 on the second one's contribution", async ({
    page,
  }) => {
    const sfx = Date.now().toString(36);
    const email = `dup.${sfx}@e2e.test`;
    const lastName = `Probe${sfx}`;

    // 1. Sign in as admin.
    await signIn(page, 'admin');

    // 2. At /payments/new add contributor Dupone, enter a payment in period 64, and open the contribution.
    let dialog = await openAddContributorDialog(page);
    await fillContributor(dialog, 'Dupone', lastName, email, '10');
    const addFirst = dialog.getByRole('button', { name: 'Add contributor' });
    await expect(addFirst).toBeEnabled();
    await addFirst.click();
    await expect(dialog).toBeHidden();
    await savePaymentAndOpen(page, '30', '2025-03-15');
    await expect(page.getByText('2025 General Election').first()).toBeVisible();
    // A lone contact has no duplicate, so no work items.
    await expect(page.getByText('None.', { exact: true })).toBeVisible();

    // 3. Return to /payments/new and add a second contributor with the SAME email.
    dialog = await openAddContributorDialog(page);
    await fillContributor(dialog, 'Duptwo', lastName, email, '11');
    // The duplicate warning appears after the first attempt to add (the plan expected it
    // while filling the form).
    await dialog.getByRole('button', { name: 'Add contributor' }).click();
    await expect(
      dialog.getByText(
        `this may be a contributor already on file: Dupone ${lastName} (${email}). Check the existing record, or confirm this is a different person`,
      ),
    ).toBeVisible();

    // 4. Tick "This is a different person; add them anyway", add, and record the second payment.
    await dialog.getByRole('checkbox', { name: 'This is a different person; add them anyway' }).check();
    await dialog.getByRole('button', { name: 'Add contributor' }).click();
    await expect(dialog).toBeHidden();
    await savePaymentAndOpen(page, '45', '2025-03-16');
    const b4Item = page.getByRole('row', { name: /Possible duplicate donor record.*\(B4\)/ });
    await expect(b4Item).toBeVisible();
    await expect(b4Item).toContainText('OPEN');

    // 5. Go to /work-queue and find the row for the second contributor.
    await page.goto('/work-queue');
    const queueRow = page
      .getByRole('row')
      .filter({ hasText: `Duptwo ${lastName}` })
      .filter({ hasText: '(B4)' });
    await expect(queueRow).toHaveCount(1);
    await expect(queueRow).toContainText('Possible duplicate donor record');
    await expect(queueRow).toContainText('OPEN');
  });
});
