// spec: specs/eo-issue-tax-receipt.md
// seed: tests/seed.spec.ts

import { expect, test, type Page } from '@playwright/test';
import { pdfTextFromBuffer, signIn } from '../../helpers.js';
import { addContributor, addPayment, createPeriod, issueSpace, newSuffix, signOut } from './recipe.js';

async function pdfOfFirstResult(page: Page): Promise<string> {
  const href = (await page.getByRole('link', { name: 'View PDF' }).first().getAttribute('href'))!;
  const response = await page.request.get(href);
  expect(response.status()).toBe(200);
  return pdfTextFromBuffer(await response.body());
}

test.describe('Issue Tax Receipt: issuance and receipt contents', () => {
  test('Row 49: Political entity name on the receipt, party and campaign', async ({ page }) => {
    const sfx = newSuffix();
    const campaignLabel = `York-Simcoe Green Campaign E2E ${sfx}`;

    // 2. (setup for both cases) As sysadmin create an ANNUAL period and a GENERAL_ELECTION period.
    await signIn(page, 'sysadmin');
    const partyPeriodId = await createPeriod(page, `${sfx}p`);
    const gePeriodId = await createPeriod(page, `${sfx}g`, { kind: 'GENERAL_ELECTION' });
    await signOut(page);

    // As admin add a contributor, a party payment, and a Campaign payment (riding 121) in the GE period.
    await signIn(page, 'admin');
    const donor = await addContributor(page, sfx);
    await addPayment(page, {
      donorName: donor.name,
      periodName: `E2E ${sfx}p`,
      amount: 50,
      receivedOn: '2024-01-10',
    });
    await addPayment(page, {
      donorName: donor.name,
      periodName: `E2E ${sfx}g`,
      amount: 25,
      receivedOn: '2024-01-12',
      recipient: 'Campaign',
      riding: '121',
    });
    await signOut(page);

    // 1. Party case. Issue from the ANNUAL period with label 'Green Party of Ontario'; fetch the PDF.
    await signIn(page, 'cfo');
    await issueSpace(page, partyPeriodId, { reason: `E2E issue ${sfx}` });
    const partyText = await pdfOfFirstResult(page);
    expect(partyText).toContain('Received By: Green Party of Ontario');

    // 3. As cfo open the campaign space.
    await page.goto(`/spaces/${gePeriodId}/CAMPAIGN/issue?ridingNumber=121`);
    await expect(page.getByText(/Period \d+\s\S\sRiding 121\s\S\sCampaign/)).toBeVisible();
    await expect(page.getByText(/open work item\(s\) block issuance/)).toHaveCount(0);
    await expect(page.getByText('Receipts', { exact: true }).locator('..')).toHaveText(/^Receipts\s*1$/);
    await expect(page.getByText('Total amount', { exact: true }).locator('..')).toHaveText(
      /^Total amount\s*\$25\.00$/,
    );

    // 4. Next: generate; the label is blank for a campaign, so type it with the reason, then generate.
    await issueSpace(page, gePeriodId, {
      entity: 'CAMPAIGN',
      ridingNumber: 121,
      label: campaignLabel,
      reason: `E2E issue ${sfx}`,
    });
    await expect(page.getByText('1 issued, 0 failed.')).toBeVisible();

    // 5. Fetch the PDF.
    const campaignText = await pdfOfFirstResult(page);
    expect(campaignText).toContain(`Received By: ${campaignLabel}`);
    expect(campaignText).not.toContain('Received By: Green Party of Ontario');
  });
});
