import { test, expect } from '@playwright/test';

// Seed for the Playwright planner and generator agents: every scenario starts
// signed out on the login page of a freshly seeded database (see
// global-setup.ts). Scenarios sign in as the user they need; the seeded
// logins are sysadmin@, cfo@, admin@, rules@, books@, filer@, and readonly@
// (all @gpo.test, password change-me-please-12345).
test.describe('Seed', () => {
  test('seed', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });
});
