// spec: specs/eo-security.md
// seed: tests/seed.spec.ts

import { test } from '@playwright/test';

test.describe('Security', () => {
  // Not a browser test: app_user.id (a cuid) and its use as the foreign key on
  // change_log_entry.actor_user_id, payment.created_by_user_id, and others
  // exist only in the schema; covered by
  // apps/tax-receipts/api/src/routes/users.test.ts and
  // apps/tax-receipts/api/src/auth/auth.test.ts.
  test.skip('Row 6: Unique user ids are covered by the API tests', () => {});
});
