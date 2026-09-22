import { describe, expect, it } from 'vitest';
import { formatDc1aAmendmentForm, type Dc1aAmendmentInput } from './dc1a.js';

function input(overrides: Partial<Dc1aAmendmentInput> = {}): Dc1aAmendmentInput {
  return {
    originalFilingName: '2026_RTD_8_030620261000',
    originalRecord: {
      contributorLastName: 'Donor',
      contributorFirstName: 'Dana',
      acceptedAt: new Date('2026-03-01T12:00:00Z'),
      amountCents: 20_001,
      aggregateAfterCents: 20_001,
      contributionYear: 2026,
      periodId: 67,
      eoContributorId: null,
    },
    reason: 'amount corrected from $150.01 to $200.01 after bank reconciliation',
    submittedAt: new Date('2026-04-01T14:00:00Z'),
    ...overrides,
  };
}

describe('formatDc1aAmendmentForm (ticket 2.4)', () => {
  it('carries the original filing name, submission date, original record, and reason', () => {
    const text = formatDc1aAmendmentForm(input());
    expect(text).toContain('Form DC-1A');
    expect(text).toContain('Original filing: 2026_RTD_8_030620261000');
    expect(text).toContain('Submission date: 04012026');
    expect(text).toContain('Contributor: Dana Donor');
    expect(text).toContain('Contributor ID: ');
    expect(text).toContain('Contribution Year: 2026');
    expect(text).toContain('Contribution Period ID: 67');
    expect(text).toContain('Deposit Date: 03012026');
    expect(text).toContain('Contribution Amount: 200.01');
    expect(text).toContain('Aggregate Contribution Amount: 200.01');
    expect(text).toContain('Reason for amendment:\namount corrected from $150.01 to $200.01 after bank reconciliation');
  });

  it('includes a populated Contributor ID when set', () => {
    const text = formatDc1aAmendmentForm(
      input({ originalRecord: { ...input().originalRecord, eoContributorId: 'DON-42' } }),
    );
    expect(text).toContain('Contributor ID: DON-42');
  });
});
