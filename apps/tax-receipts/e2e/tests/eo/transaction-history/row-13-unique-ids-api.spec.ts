// spec: specs/eo-transaction-history.md
// seed: tests/seed.spec.ts

import { test } from '@playwright/test';

test.describe('Transaction History', () => {
  // Not a browser test: change_log_entry.id is in the schema and the API JSON,
  // not the change-log table; covered by
  // apps/tax-receipts/api/src/changelog/write.test.ts and
  // apps/tax-receipts/api/src/changelog/list.test.ts.
  test.skip('Row 13: Unique audit record ids are covered by the API tests', () => {});
});
