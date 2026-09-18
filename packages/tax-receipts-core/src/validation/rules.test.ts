import { describe, expect, it } from 'vitest';
import type { PeriodRow } from '../period/calendar.js';
import type { ContributionForValidationRules } from './types.js';
import {
  CASH_LIMIT_CENTS,
  checkA1PeriodWindow,
  checkA2RidingEntityConsistency,
  checkA5NonDeductible,
  checkA6DuplicateContribution,
  checkA7SourceCodeRiding,
  checkA8CashLimit,
  checkB2OverLimit,
  checkB4DuplicateContributorByEmail,
  runContributionRules,
} from './rules.js';

const period: PeriodRow = {
  id: 67,
  name: '2026 Annual',
  kind: 'ANNUAL',
  ridingNumbers: [],
  startsAt: new Date('2026-01-01T05:00:00Z'),
  endsAt: new Date('2027-01-01T05:00:00Z'),
};

function contribution(
  overrides: Partial<ContributionForValidationRules> = {},
  metadataOverrides: Partial<ContributionForValidationRules['metadata']> = {},
): ContributionForValidationRules {
  return {
    id: 'c1',
    amountCents: 5_000,
    acceptedAt: new Date('2026-03-01T12:00:00Z'),
    paymentMethodKind: 'card',
    externalRef: null,
    metadata: {
      periodId: 67,
      ridingNumber: null,
      entityKind: 'PARTY',
      receivedBy: 'GPO',
      goodsServices: false,
      nonDeductibleCents: 0,
      sourceCode: '',
      ...metadataOverrides,
    },
    ...overrides,
  };
}

describe('A1 period window', () => {
  it('passes when the acceptance date is inside the period', () => {
    expect(checkA1PeriodWindow(contribution(), period)).toBeNull();
  });

  it('flags when the period is not configured', () => {
    expect(checkA1PeriodWindow(contribution(), undefined)?.ruleRef).toBe('A1');
  });

  it('flags when the acceptance date is outside the period window', () => {
    const c = contribution({ acceptedAt: new Date('2020-01-01T00:00:00Z') });
    expect(checkA1PeriodWindow(c, period)?.ruleRef).toBe('A1');
  });
});

describe('A2 riding/entity consistency', () => {
  it('passes PARTY with no riding', () => {
    expect(checkA2RidingEntityConsistency(contribution())).toBeNull();
  });

  it('flags PARTY carrying a riding number', () => {
    const c = contribution({}, { entityKind: 'PARTY', ridingNumber: 84 });
    expect(checkA2RidingEntityConsistency(c)?.ruleRef).toBe('A2');
  });

  it('flags CA/CAMPAIGN with no riding number', () => {
    const c = contribution({}, { entityKind: 'CA', ridingNumber: null });
    expect(checkA2RidingEntityConsistency(c)?.ruleRef).toBe('A2');
  });

  it('flags an out-of-range riding number', () => {
    const c = contribution({}, { entityKind: 'CA', ridingNumber: 200 });
    expect(checkA2RidingEntityConsistency(c)?.ruleRef).toBe('A2');
  });

  it('passes CA with a valid riding number', () => {
    const c = contribution({}, { entityKind: 'CA', ridingNumber: 84 });
    expect(checkA2RidingEntityConsistency(c)).toBeNull();
  });
});

describe('A5 non-deductible', () => {
  it('passes a fully eligible contribution', () => {
    expect(checkA5NonDeductible(contribution({ amountCents: 5_000 }, { nonDeductibleCents: 1_000 }))).toBeNull();
  });

  it('flags non-deductible exceeding the amount', () => {
    const c = contribution({ amountCents: 1_000 }, { nonDeductibleCents: 2_000 });
    expect(checkA5NonDeductible(c)?.ruleRef).toBe('A5');
  });

  it('flags a zero eligible amount', () => {
    const c = contribution({ amountCents: 1_000 }, { nonDeductibleCents: 1_000 });
    expect(checkA5NonDeductible(c)?.ruleRef).toBe('A5');
  });
});

describe('A6 duplicate contribution', () => {
  it('flags a matching external_ref regardless of amount/date', () => {
    const c = contribution({ id: 'c1', externalRef: 'ch_123', acceptedAt: new Date('2026-03-01T00:00:00Z') });
    const finding = checkA6DuplicateContribution(c, [
      { id: 'c2', amountCents: 1, acceptedAt: new Date('2020-01-01T00:00:00Z'), externalRef: 'ch_123', entityKind: 'PARTY', ridingNumber: null },
    ]);
    expect(finding?.ruleRef).toBe('A6');
  });

  it('flags same donor + amount + entity within the window', () => {
    const c = contribution({ id: 'c1', acceptedAt: new Date('2026-03-01T00:00:00Z'), amountCents: 5_000 });
    const finding = checkA6DuplicateContribution(c, [
      { id: 'c2', amountCents: 5_000, acceptedAt: new Date('2026-03-02T00:00:00Z'), externalRef: null, entityKind: 'PARTY', ridingNumber: null },
    ]);
    expect(finding?.ruleRef).toBe('A6');
  });

  it('does not flag outside the window or a different amount', () => {
    const c = contribution({ id: 'c1', acceptedAt: new Date('2026-03-01T00:00:00Z'), amountCents: 5_000 });
    expect(
      checkA6DuplicateContribution(c, [
        { id: 'c2', amountCents: 5_000, acceptedAt: new Date('2026-04-01T00:00:00Z'), externalRef: null, entityKind: 'PARTY', ridingNumber: null },
      ]),
    ).toBeNull();
    expect(
      checkA6DuplicateContribution(c, [
        { id: 'c2', amountCents: 1, acceptedAt: new Date('2026-03-01T00:00:00Z'), externalRef: null, entityKind: 'PARTY', ridingNumber: null },
      ]),
    ).toBeNull();
  });

  it('ignores itself in the candidate list', () => {
    const c = contribution({ id: 'c1' });
    expect(
      checkA6DuplicateContribution(c, [
        { id: 'c1', amountCents: c.amountCents, acceptedAt: c.acceptedAt, externalRef: null, entityKind: 'PARTY', ridingNumber: null },
      ]),
    ).toBeNull();
  });
});

describe('A7 source-code riding', () => {
  it('passes when there is no directed segment to compare', () => {
    const c = contribution({}, { sourceCode: 'NC.W.DON.DBK.BTN50' });
    expect(checkA7SourceCodeRiding(c)).toBeNull();
  });

  it('passes when the directed riding matches metadata', () => {
    const c = contribution({}, { sourceCode: 'TSF.W.007', ridingNumber: 7, entityKind: 'CA' });
    expect(checkA7SourceCodeRiding(c)).toBeNull();
  });

  it('flags a mismatch between the directed source code and metadata riding', () => {
    const c = contribution({}, { sourceCode: 'TSF.W.007', ridingNumber: 12, entityKind: 'CA' });
    expect(checkA7SourceCodeRiding(c)?.ruleRef).toBe('A7');
  });
});

describe('A8 cash limit', () => {
  it('passes a cash contribution at or under $25', () => {
    expect(checkA8CashLimit(contribution({ paymentMethodKind: 'cash', amountCents: CASH_LIMIT_CENTS }))).toBeNull();
  });

  it('flags a cash contribution over $25', () => {
    const c = contribution({ paymentMethodKind: 'cash', amountCents: CASH_LIMIT_CENTS + 1 });
    expect(checkA8CashLimit(c)?.ruleRef).toBe('A8');
  });

  it('ignores non-cash payment methods regardless of amount', () => {
    expect(checkA8CashLimit(contribution({ paymentMethodKind: 'card', amountCents: 1_000_000 }))).toBeNull();
  });
});

describe('B2 over limit', () => {
  it('flags when the aggregate including this contribution exceeds the bucket limit', () => {
    const finding = checkB2OverLimit({
      contribution: {
        id: 'c1',
        amountCents: 400_000,
        goodsServices: false,
        entityKind: 'PARTY',
        ridingNumber: null,
        year: 2026,
        candidateSelf: false,
        leadership: false,
      },
      otherContributionsThisYear: [
        { id: 'c0', amountCents: 200_000, goodsServices: false, entityKind: 'PARTY', ridingNumber: null, year: 2026, candidateSelf: false, leadership: false },
      ],
      limits: [{ year: 2026, bucket: 'PARTY', amountCents: 500_000 }],
    });
    expect(finding?.ruleRef).toBe('B2');
  });

  it('passes when under the limit', () => {
    const finding = checkB2OverLimit({
      contribution: { id: 'c1', amountCents: 100, goodsServices: false, entityKind: 'PARTY', ridingNumber: null, year: 2026, candidateSelf: false, leadership: false },
      otherContributionsThisYear: [],
      limits: [{ year: 2026, bucket: 'PARTY', amountCents: 500_000 }],
    });
    expect(finding).toBeNull();
  });
});

describe('B4 duplicate contributor by email', () => {
  it('flags a shared, case-insensitive email on a different contact', () => {
    const finding = checkB4DuplicateContributorByEmail('c1', 'Dana@Example.org', [
      { contactId: 'c2', email: 'dana@example.org' },
    ]);
    expect(finding?.ruleRef).toBe('B4');
  });

  it('ignores its own contact and a null email', () => {
    expect(
      checkB4DuplicateContributorByEmail('c1', 'dana@example.org', [{ contactId: 'c1', email: 'dana@example.org' }]),
    ).toBeNull();
    expect(checkB4DuplicateContributorByEmail('c1', null, [{ contactId: 'c2', email: 'dana@example.org' }])).toBeNull();
  });
});

describe('runContributionRules', () => {
  it('runs every rule and collects every finding', () => {
    const c = contribution(
      { paymentMethodKind: 'cash', amountCents: 10_000 },
      { entityKind: 'PARTY', ridingNumber: 84 }, // A2 violation: PARTY with a riding
    );
    const findings = runContributionRules({
      contribution: c,
      contactId: 'contact-1',
      contactEmail: null,
      period,
      duplicateContributionCandidates: [],
      duplicateContactCandidates: [],
      overLimit: null,
    });
    const refs = findings.map((f) => f.ruleRef).sort();
    expect(refs).toEqual(['A2', 'A8']); // riding-on-PARTY, and cash over $25
  });

  it('skips B2 entirely when overLimit context is null', () => {
    const findings = runContributionRules({
      contribution: contribution(),
      contactId: 'contact-1',
      contactEmail: null,
      period,
      duplicateContributionCandidates: [],
      duplicateContactCandidates: [],
      overLimit: null,
    });
    expect(findings.some((f) => f.ruleRef === 'B2')).toBe(false);
  });
});
