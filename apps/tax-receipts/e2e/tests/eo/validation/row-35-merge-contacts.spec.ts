// spec: specs/eo-validation.md
// seed: tests/seed.spec.ts

import { expect, test, type Page } from '@playwright/test';
import { signIn } from '../../helpers.js';

async function savePaymentAndOpen(page: Page, amount: string, receivedOn: string, reason: string) {
  await page.getByRole('textbox', { name: 'Amount ($)' }).first().fill(amount);
  await page.getByRole('textbox', { name: 'Received on' }).fill(receivedOn);
  await page.getByRole('textbox', { name: 'Reason (required)' }).fill(reason);
  await page.getByRole('button', { name: 'Save payment' }).click();
  await page.getByRole('link', { name: 'Open the contribution' }).click();
  await expect(page).toHaveURL(/\/contributions\/[^/]+$/);
}

test.describe('Validation and Controls', () => {
  test('Row 35: Resolve duplicate contributors with MERGE_CONTACTS and show the merge is reversible', async ({
    page,
  }) => {
    const sfx = Date.now().toString(36);
    const oneName = `Dupone Merge${sfx}`;
    const twoName = `Duptwo Merge${sfx}`;
    const email = `merge.${sfx}@e2e.test`;
    const reason = `e2e merge ${sfx}`;

    // 1. Sign in as admin.
    await signIn(page, 'admin');

    // 2. Create both contributors and payments (Dupone: $30 on 2025-03-15; Duptwo: $45 on
    //    2025-03-16, ticking the different-person box). Open Duptwo's contribution and
    //    record its id and the Duptwo contact id.
    await page.goto('/payments/new');
    await page.getByRole('button', { name: 'Not on file? Add a new contributor' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'First name' }).fill('Dupone');
    await dialog.getByRole('textbox', { name: 'Last name' }).fill(`Merge${sfx}`);
    await dialog.getByRole('textbox', { name: 'Email' }).fill(email);
    await dialog.getByRole('textbox', { name: 'Street number' }).fill('10');
    await dialog.getByRole('textbox', { name: 'Street', exact: true }).fill('Queen St');
    await dialog.getByRole('textbox', { name: 'City' }).fill('Toronto');
    await dialog.getByRole('textbox', { name: 'Postal code' }).fill('M5V 2T6');
    await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill(reason);
    await dialog.getByRole('button', { name: 'Add contributor' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Donor who paid' })).toHaveValue(
      new RegExp(oneName),
    );
    await savePaymentAndOpen(page, '30', '2025-03-15', reason);

    await page.goto('/payments/new');
    await page.getByRole('button', { name: 'Not on file? Add a new contributor' }).click();
    await dialog.getByRole('textbox', { name: 'First name' }).fill('Duptwo');
    await dialog.getByRole('textbox', { name: 'Last name' }).fill(`Merge${sfx}`);
    await dialog.getByRole('textbox', { name: 'Email' }).fill(email);
    await dialog.getByRole('textbox', { name: 'Street number' }).fill('11');
    await dialog.getByRole('textbox', { name: 'Street', exact: true }).fill('Queen St');
    await dialog.getByRole('textbox', { name: 'City' }).fill('Toronto');
    await dialog.getByRole('textbox', { name: 'Postal code' }).fill('M5V 2T6');
    await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill(reason);
    // The duplicate-email warning appears only after the first click.
    await dialog.getByRole('button', { name: 'Add contributor' }).click();
    await expect(dialog.getByText(/this may be a contributor already on file/)).toBeVisible();
    await dialog.getByRole('checkbox', { name: 'This is a different person; add them anyway' }).check();
    await dialog.getByRole('button', { name: 'Add contributor' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Donor who paid' })).toHaveValue(
      new RegExp(twoName),
    );
    await savePaymentAndOpen(page, '45', '2025-03-16', reason);

    const originalId = page.url().split('/').pop()!;
    const donorHref = await page
      .getByRole('link', { name: twoName })
      .first()
      .getAttribute('href');
    const contactId = donorHref!.split('/').pop()!;
    expect(contactId).toBeTruthy();
    await expect(
      page.getByRole('row', { name: /Possible duplicate donor record/ }),
    ).toContainText('OPEN');

    // 3. Click 'Correct' in the Contribution card and choose Action 'Merge this donor into
    //    another contact'.
    await page.getByRole('button', { name: 'Correct' }).click();
    const correct = page.getByRole('dialog');
    await correct.getByLabel('Action').selectOption('Merge this donor into another contact');
    const mergeInto = correct.getByRole('textbox', { name: `Merge ${twoName} into` });
    await expect(mergeInto).toBeVisible();
    await expect(
      correct.getByRole('textbox', { name: /Evidence they are the same person/ }),
    ).toBeVisible();
    await expect(correct.getByRole('button', { name: 'Commit correction' })).toBeDisabled();

    // 4. Pick the surviving contact, fill the reason, and preview the cascade.
    await mergeInto.fill(oneName);
    await page.getByRole('option', { name: `${oneName} (${email})` }).click();
    await correct
      .getByRole('textbox', { name: 'Reason (required)' })
      .fill('e2e same person, duplicate record');
    await correct.getByRole('button', { name: 'Preview cascade' }).click();
    await expect(
      correct.getByRole('cell', { name: `${twoName}, $45.00, Party (province-wide)` }),
    ).toBeVisible();
    await expect(correct.getByRole('cell', { name: 'becomes' })).toBeVisible();
    await expect(
      correct.getByRole('cell', { name: `${oneName}, $45.00, Party (province-wide)` }),
    ).toBeVisible();
    await expect(correct.getByText('None affected: nothing had been receipted.')).toBeVisible();
    await expect(correct.getByRole('button', { name: 'Commit correction' })).toBeEnabled();

    // 5. Click 'Commit correction'.
    await correct.getByRole('button', { name: 'Commit correction' }).click();
    await expect(correct.getByText('Correction committed')).toBeVisible();
    await expect(
      correct.getByText('1 contribution created, 0 receipts cancelled, no receipts issued.'),
    ).toBeVisible();
    await expect(correct.getByRole('link', { name: 'open it' })).toBeVisible();

    // 6. Close the dialog; read the original contribution page.
    await page.keyboard.press('Escape');
    await expect(correct).toBeHidden();
    await expect(
      page.getByText('This contribution is SUPERSEDED; it is history, not the working record.'),
    ).toBeVisible();

    // 7. Go to /work-queue and find the row for Duptwo.
    await page.goto('/work-queue');
    const queueRow = page.getByRole('row').filter({ hasText: twoName });
    await expect(queueRow).toHaveCount(1);
    await expect(queueRow).toContainText('Possible duplicate donor record');
    await expect(queueRow).toContainText('(B4)');
    await expect(queueRow).toContainText('RESOLVED');
    await expect(queueRow).toContainText(`closed by a correction: ${originalId} is now SUPERSEDED`);

    // 8. Go to /contributors and search for Dupone, open the contributor.
    await page.goto('/contributors');
    const search = page.getByPlaceholder('Name or email (two letters or more)');
    await search.fill(oneName);
    await page.getByRole('link', { name: oneName }).click();
    const moved = page.getByRole('row').filter({ hasText: '$45.00' });
    await expect(moved).toContainText('3/16/2025');
    await expect(moved).toContainText('ACTIVE');
    const kept = page.getByRole('row').filter({ hasText: '$30.00' });
    await expect(kept).toContainText('3/15/2025');
    await expect(kept).toContainText('ACTIVE');

    await page.goto('/contributors');
    await search.fill(twoName);
    await expect(page.getByText('No contributors match.')).toBeVisible();
    await expect(page.getByRole('link', { name: twoName })).toHaveCount(0);

    // 9. Show reversibility: unmerge through the API (the UI has no Unmerge button).
    const unmerge = await page.request.post(`/api/contacts/${contactId}/unmerge`, {
      data: { reason: `e2e they are two people ${sfx}` },
    });
    expect(unmerge.status()).toBe(200);
    expect(await unmerge.json()).toMatchObject({ contactId, mergedIntoId: null });

    // 10. Open the Duptwo contributor page again.
    await page.goto(`/contributors/${contactId}`);
    await expect(page.getByRole('heading', { name: twoName })).toBeVisible();
    // Unmerge restores the contact; it does not move the contribution back.
    const supersededRow = page.getByRole('row').filter({ hasText: '$45.00' });
    await expect(supersededRow).toContainText('SUPERSEDED');
  });
});
