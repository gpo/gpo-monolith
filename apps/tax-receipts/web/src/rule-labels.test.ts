import { expect, test } from 'vitest';
import { IMPLEMENTED_RULE_REFS } from '@gpo/tax-receipts-core/validation/rules.js';
import { RULE_LABELS } from './rule-labels.js';

/**
 * Keeps RULE_LABELS honest against the rule engine: every ruleRef
 * `runContributionRules` can actually produce (packages/tax-receipts-core)
 * must have a human label here, or the admin "Validation rules" page
 * (admin.tsx) would silently omit it. RULE_LABELS is allowed to carry
 * extra entries for rules not yet implemented (A9, B5, E*, REP*) — this
 * only checks the direction that matters.
 */
test('every implemented rule has a RULE_LABELS entry', () => {
  const missing = IMPLEMENTED_RULE_REFS.filter((ref) => !(ref in RULE_LABELS));
  expect(missing).toEqual([]);
});
