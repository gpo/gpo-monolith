// spec: specs/eo-security.md
// seed: tests/seed.spec.ts

import { expect, test, type Page } from '@playwright/test';
import { signIn } from '../../helpers.js';

async function signInAs(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeHidden();
}

test.describe('Security', () => {
  test('Row 8: Functions assigned to a role take effect live, and System administrator is locked', async ({
    page,
    browser,
  }) => {
    const sfx = Date.now().toString(36);
    const roleName = `E2E Report Role ${sfx}`;
    const userName = `E2E Reporter ${sfx}`;
    const userEmail = `e2e-reporter-${sfx}@gpo.test`;
    const userPassword = 'reporter-pass-12345';
    const pageA = page;

    // 1. Sign in as sysadmin in context A. Create the role with 'Read all records' and 'Generate entity reports' only.
    await signIn(pageA, 'sysadmin');
    await pageA.goto('/admin/roles');
    await pageA.getByRole('button', { name: 'New role' }).click();
    await pageA.getByLabel('Name', { exact: true }).fill(roleName);
    await pageA.getByRole('checkbox', { name: 'Read all records' }).check();
    await pageA.getByRole('checkbox', { name: 'Generate entity reports' }).check();
    await pageA.getByLabel('Reason for this change (required)').fill('Reporter role');
    await pageA.getByRole('button', { name: 'Create role' }).click();
    const roleRow = pageA.getByRole('row').filter({ hasText: roleName });
    await expect(roleRow).toBeVisible();
    await expect(roleRow.getByText('Read all records')).toBeVisible();
    await expect(roleRow.getByText('Generate entity reports')).toBeVisible();
    await expect(roleRow.getByText('Share entity reports')).toHaveCount(0);

    // 2. In Admin, Users create the user with the new role.
    await pageA.goto('/admin/users');
    await pageA.getByRole('button', { name: 'New user' }).click();
    await pageA.getByRole('textbox', { name: 'Name' }).fill(userName);
    await pageA.getByLabel('Email (used to sign in)').fill(userEmail);
    await pageA.getByLabel('Temporary password').fill(userPassword);
    await pageA.getByRole('combobox', { name: 'Role' }).selectOption(roleName);
    await pageA.getByRole('button', { name: 'Create user' }).click();
    const userRow = pageA.getByRole('row').filter({ hasText: userEmail });
    await expect(userRow).toBeVisible();
    await expect(userRow).toContainText(roleName);

    // 3. In a second browser context B, sign in as the new user and open Reports on 2025 Annual / Party.
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await signInAs(pageB, userEmail, userPassword);
    await pageB
      .getByRole('row')
      .filter({ hasText: '2025 Annual' })
      .filter({ hasText: 'Party (province-wide)' })
      .getByRole('button', { name: 'Reports' })
      .click();
    await expect(pageB.getByRole('heading', { name: 'Entity reports' })).toBeVisible();
    await expect(
      pageB.getByText('Only the party CFO, a designate, bookkeeper, or filer may generate reports.'),
    ).toHaveCount(0);
    await pageB.getByLabel('Reason for generating (required)').fill('Reporter generate');
    await expect(pageB.getByRole('button', { name: 'Generate' })).toBeEnabled();
    const reportsUrl = pageB.url();

    // 4. Generate an ALL report, then go to Issue and on to the Generate step.
    await pageB.getByRole('button', { name: 'Generate' }).click();
    const newReport = pageB
      .getByRole('row')
      .filter({ hasText: 'Not sent' })
      .first();
    await expect(newReport).toBeVisible();
    await expect(newReport.getByText('Not sent')).toBeVisible();
    await expect(pageB.getByRole('button', { name: 'Mark sent' })).toHaveCount(0);

    await pageB.goto('/');
    await pageB
      .getByRole('row')
      .filter({ hasText: '2025 Annual' })
      .filter({ hasText: 'Party (province-wide)' })
      .getByRole('button', { name: 'Issue' })
      .click();
    await pageB.getByRole('button', { name: 'Next: generate' }).click();
    const issueAlert =
      'Only the party CFO (or an authorized designate) may issue receipts (s. 25.1(6)).';
    await expect(pageB.getByText(issueAlert)).toBeVisible();
    await expect(pageB.getByRole('button', { name: 'Generate receipts' })).toBeDisabled();

    // 5. In context A, edit the role: tick 'Share entity reports', reason 'Add share', save.
    await pageA.goto('/admin/roles');
    await pageA
      .getByRole('row')
      .filter({ hasText: roleName })
      .getByRole('button', { name: 'Edit' })
      .click();
    await pageA.getByRole('checkbox', { name: 'Share entity reports' }).check();
    await pageA.getByLabel('Reason for this change (required)').fill('Add share');
    await pageA.getByRole('dialog').getByRole('button', { name: /^Save/ }).click();
    await expect(pageA.getByRole('dialog')).toBeHidden();
    await expect(
      pageA.getByRole('row').filter({ hasText: roleName }).getByText('Share entity reports'),
    ).toBeVisible();

    // 6. In context B, without signing out, reload the Entity reports page.
    await pageB.goto(reportsUrl);
    await expect(pageB.getByRole('button', { name: 'Mark sent' }).first()).toBeVisible();
    await expect(pageB.getByRole('button', { name: 'Account menu' })).toBeVisible();
    await pageB.goto(reportsUrl.replace('/entity-reports', '/issue'));
    await pageB.getByRole('button', { name: 'Next: generate' }).click();
    await expect(pageB.getByText(issueAlert)).toBeVisible();
    await expect(pageB.getByRole('button', { name: 'Generate receipts' })).toBeDisabled();
    await contextB.close();

    // 7. In context A open Admin, Change log, Subject type 'Role', find the update entry.
    await pageA.goto('/admin/change-log');
    await pageA.getByRole('combobox', { name: 'Subject type' }).selectOption('Role');
    const updateRow = pageA.getByRole('row').filter({ hasText: 'Add share' }).filter({
      hasText: `${sfx}`,
    });
    // The Before/After cells truncate the JSON at about 80 characters, so the
    // permission lists are read from the API behind the same page.
    await expect(updateRow).toBeVisible();
    await expect(updateRow).toContainText('Sys Admin');
    const res = await pageA.request.get('/api/change-log?subjectType=Role');
    expect(res.ok()).toBeTruthy();
    const entries = (await res.json()).data as Array<{
      name?: string;
      reason: string;
      actorName: string;
      before: { name: string; permissions: string[] } | null;
      after: { name: string; permissions: string[] } | null;
    }>;
    const update = entries.find((e) => e.reason === 'Add share' && e.after?.name === roleName);
    expect(update).toBeDefined();
    expect(update!.actorName).toBe('Sys Admin');
    expect(update!.before!.permissions.sort()).toEqual(['entityReport.generate', 'records.readAll']);
    expect(update!.after!.permissions.sort()).toEqual([
      'entityReport.generate',
      'entityReport.share',
      'records.readAll',
    ]);

    // 8. In Admin, Roles click 'View' on 'System administrator'.
    await pageA.goto('/admin/roles');
    const sysRow = pageA.getByRole('row').filter({ hasText: 'System administrator' });
    await expect(sysRow.getByText('Locked')).toBeVisible();
    await expect(sysRow.getByRole('button', { name: 'Delete role' })).toHaveCount(0);
    await sysRow.getByRole('button', { name: 'View' }).click();
    const dialog = pageA.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'System administrator' })).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: 'Full system access' })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'Full system access' })).toBeDisabled();
    await expect(dialog.getByRole('textbox', { name: 'Name' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: /^Save/ })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Delete role' })).toHaveCount(0);
  });
});
