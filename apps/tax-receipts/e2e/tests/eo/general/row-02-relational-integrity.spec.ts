// spec: specs/eo-general.md
// seed: tests/seed.spec.ts

import { test } from '@playwright/test';

test.describe('General', () => {
  // Not a browser test: relational integrity (foreign keys, no hard deletes,
  // split payments summing to the payment) lives in the schema and is covered
  // by apps/tax-receipts/api/src/invariants/db-invariants.test.ts and
  // apps/tax-receipts/api/src/invariants/payment-contribution.test.ts.
  test.skip('Row 2: Relational integrity is covered by the API tests', () => {});
});
