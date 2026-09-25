import { describe, expect, it } from 'vitest';
import type { PeriodRow } from '../period/calendar.js';
import type { RidingRow } from '../space/eligibility.js';
import type { AddressForValidation, ContributionForValidationRules } from './types.js';
import {
  CASH_LIMIT_CENTS,
  checkA1PeriodWindow,
  checkA2RidingEntityConsistency,
  checkA3EntityActive,
  checkA4ReceivedByProvenance,
  checkA5NonDeductible,
  checkA6DuplicateContribution,
  checkA7SourceCodeRiding,
  checkA8CashLimit,
  checkB1OutOfProvince,
  checkB2OverLimit,
  checkB3AnonymousDonor,
  checkB4DuplicateContributorByEmail,
  checkC1AddressComplete,
  checkC2AddressNoCommas,
  checkC3PostalCode,
  checkC4PrintableName,
  checkC5AddressSnapshotExists,
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

const byElectionPeriod: PeriodRow = {
  id: 68,
  name: 'York-Simcoe by-election',
  kind: 'BY_ELECTION',
  ridingNumbers: [84],
  startsAt: new Date('2026-06-01T05:00:00Z'),
  endsAt: new Date('2026-09-01T05:00:00Z'),
};

const activeRiding: RidingRow = { ridingNumber: 84, active: true };
const defunctRiding: RidingRow = { ridingNumber: 84, active: false };

const validAddress: AddressForValidation = {
  line1: '123 Main St',
  city: 'Toronto',
  province: 'ON',
  postalCode: 'M5V 2T6',
  country: 'CA',
};

function contribution(
  overrides: Partial<ContributionForValidationRules> = {},
  metadataOverrides: Partial<ContributionForValidationRules['metadata']> = {},
): ContributionForValidationRules {
  return {
    id: 'c1',
    amountCents: 5_000,
    acceptedAt: new Date('2026-03-01T12:00:00Z'),
    paymentMethod: 'CARD',
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

  it('skips the campaign-activity clause when no period/riding context is given', () => {
    const c = contribution({}, { entityKind: 'CAMPAIGN', ridingNumber: 84 });
    expect(checkA2RidingEntityConsistency(c)).toBeNull();
  });

  it('flags CAMPAIGN in a riding with no active campaign for an ANNUAL period', () => {
    const c = contribution({}, { entityKind: 'CAMPAIGN', ridingNumber: 84 });
    expect(checkA2RidingEntityConsistency(c, period, activeRiding)?.ruleRef).toBe('A2');
  });

  it('passes CAMPAIGN in a riding named in an active by-election period', () => {
    const c = contribution({}, { entityKind: 'CAMPAIGN', ridingNumber: 84 });
    expect(checkA2RidingEntityConsistency(c, byElectionPeriod, activeRiding)).toBeNull();
  });

  it('flags CAMPAIGN in a by-election period that does not name the riding', () => {
    const c = contribution({}, { entityKind: 'CAMPAIGN', ridingNumber: 12 });
    expect(checkA2RidingEntityConsistency(c, byElectionPeriod, { ridingNumber: 12, active: true })?.ruleRef).toBe(
      'A2',
    );
  });
});

describe('A3 entity active', () => {
  it('passes PARTY unconditionally', () => {
    expect(checkA3EntityActive(contribution(), undefined)).toBeNull();
  });

  it('passes CA in an active riding', () => {
    const c = contribution({}, { entityKind: 'CA', ridingNumber: 84 });
    expect(checkA3EntityActive(c, activeRiding)).toBeNull();
  });

  it('flags CA in a defunct riding', () => {
    const c = contribution({}, { entityKind: 'CA', ridingNumber: 84 });
    expect(checkA3EntityActive(c, defunctRiding)?.ruleRef).toBe('A3');
  });

  it('flags CA in an unknown riding', () => {
    const c = contribution({}, { entityKind: 'CA', ridingNumber: 84 });
    expect(checkA3EntityActive(c, undefined)?.ruleRef).toBe('A3');
  });

  it('leaves CAMPAIGN activity to A2 (does not flag)', () => {
    const c = contribution({}, { entityKind: 'CAMPAIGN', ridingNumber: 84 });
    expect(checkA3EntityActive(c, defunctRiding)).toBeNull();
  });
});

describe('A4 received_by provenance', () => {
  it('passes a non-processor contribution regardless of received_by', () => {
    const c = contribution({ externalRef: null }, { receivedBy: 'ENTITY' });
    expect(checkA4ReceivedByProvenance(c)).toBeNull();
  });

  it('passes a processor record with received_by GPO', () => {
    const c = contribution({ externalRef: 'ch_123' }, { receivedBy: 'GPO' });
    expect(checkA4ReceivedByProvenance(c)).toBeNull();
  });

  it('flags a processor record with received_by ENTITY', () => {
    const c = contribution({ externalRef: 'ch_123' }, { receivedBy: 'ENTITY' });
    expect(checkA4ReceivedByProvenance(c)?.ruleRef).toBe('A4');
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
    expect(checkA8CashLimit(contribution({ paymentMethod: 'CASH', amountCents: CASH_LIMIT_CENTS }))).toBeNull();
  });

  it('flags a cash contribution over $25', () => {
    const c = contribution({ paymentMethod: 'CASH', amountCents: CASH_LIMIT_CENTS + 1 });
    expect(checkA8CashLimit(c)?.ruleRef).toBe('A8');
  });

  it('ignores non-cash payment methods regardless of amount', () => {
    expect(checkA8CashLimit(contribution({ paymentMethod: 'CARD', amountCents: 1_000_000 }))).toBeNull();
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

describe('B1 out of province', () => {
  it('passes a null address (C1 handles absence)', () => {
    expect(checkB1OutOfProvince(null)).toBeNull();
  });

  it('passes an Ontario address', () => {
    expect(checkB1OutOfProvince(validAddress)).toBeNull();
  });

  it('flags a non-Ontario province', () => {
    expect(checkB1OutOfProvince({ ...validAddress, province: 'BC' })?.ruleRef).toBe('B1');
  });
});

describe('B3 anonymous donor', () => {
  it('passes a normal name', () => {
    expect(checkB3AnonymousDonor('Dana Smith')).toBeNull();
  });

  it('flags a blank name', () => {
    expect(checkB3AnonymousDonor('  ')?.ruleRef).toBe('B3');
  });

  it('flags common anonymous placeholders, case-insensitively', () => {
    expect(checkB3AnonymousDonor('Anonymous')?.ruleRef).toBe('B3');
    expect(checkB3AnonymousDonor('unknown')?.ruleRef).toBe('B3');
    expect(checkB3AnonymousDonor('N/A')?.ruleRef).toBe('B3');
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

describe('C1 address complete', () => {
  it('passes a complete address', () => {
    expect(checkC1AddressComplete(validAddress)).toBeNull();
  });

  it('flags a null address', () => {
    expect(checkC1AddressComplete(null)?.ruleRef).toBe('C1');
  });

  it('flags missing fields by name', () => {
    const finding = checkC1AddressComplete({ ...validAddress, city: '', postalCode: '' });
    expect(finding?.message).toContain('city');
    expect(finding?.message).toContain('postal code');
  });
});

describe('C2 address no commas', () => {
  it('passes a comma-free line1', () => {
    expect(checkC2AddressNoCommas(validAddress)).toBeNull();
  });

  it('flags a comma in line1', () => {
    expect(checkC2AddressNoCommas({ ...validAddress, line1: '123 Main St, Apt 4' })?.ruleRef).toBe('C2');
  });

  it('passes a null address (C1 handles absence)', () => {
    expect(checkC2AddressNoCommas(null)).toBeNull();
  });
});

describe('C3 postal code', () => {
  it('passes a well-formed Ontario postal code', () => {
    expect(checkC3PostalCode(validAddress)).toBeNull();
  });

  it('passes with or without the internal space', () => {
    expect(checkC3PostalCode({ ...validAddress, postalCode: 'M5V2T6' })).toBeNull();
  });

  it('flags a malformed postal code', () => {
    expect(checkC3PostalCode({ ...validAddress, postalCode: '12345' })?.ruleRef).toBe('C3');
  });

  it('flags a well-formed but non-Ontario postal code', () => {
    expect(checkC3PostalCode({ ...validAddress, postalCode: 'V6B 1A1' })?.ruleRef).toBe('C3');
  });

  it('passes a null address or blank postal code (C1 handles absence)', () => {
    expect(checkC3PostalCode(null)).toBeNull();
    expect(checkC3PostalCode({ ...validAddress, postalCode: '' })).toBeNull();
  });
});

describe('C4 printable name', () => {
  it('passes a normal full name', () => {
    expect(checkC4PrintableName('Dana Smith')).toBeNull();
  });

  it('flags a blank name', () => {
    expect(checkC4PrintableName('  ')?.ruleRef).toBe('C4');
  });

  it('flags an initial', () => {
    expect(checkC4PrintableName('D. Smith')?.ruleRef).toBe('C4');
  });

  it('flags a joint name', () => {
    expect(checkC4PrintableName('June and John Smith')?.ruleRef).toBe('C4');
  });

  it('flags a single-word name', () => {
    expect(checkC4PrintableName('Cher')?.ruleRef).toBe('C4');
  });
});

describe('C5 address snapshot exists (no-op pending Phase 3)', () => {
  it('always passes', () => {
    expect(checkC5AddressSnapshotExists()).toBeNull();
  });
});

describe('runContributionRules', () => {
  it('runs every rule and collects every finding', () => {
    const c = contribution(
      { paymentMethod: 'CASH', amountCents: 10_000 },
      { entityKind: 'PARTY', ridingNumber: 84 }, // A2 violation: PARTY with a riding
    );
    const findings = runContributionRules({
      contribution: c,
      contactId: 'contact-1',
      contactName: 'Dana Smith',
      contactEmail: null,
      address: validAddress,
      period,
      riding: undefined,
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
      contactName: 'Dana Smith',
      contactEmail: null,
      address: validAddress,
      period,
      riding: undefined,
      duplicateContributionCandidates: [],
      duplicateContactCandidates: [],
      overLimit: null,
    });
    expect(findings.some((f) => f.ruleRef === 'B2')).toBe(false);
  });

  it('collects findings across the newly added A3/A4/B1/B3/C1-C5 rules', () => {
    const c = contribution(
      { externalRef: 'ch_123' },
      { entityKind: 'CA', ridingNumber: 84, receivedBy: 'ENTITY' }, // A4 violation
    );
    const findings = runContributionRules({
      contribution: c,
      contactId: 'contact-1',
      contactName: 'Anonymous',
      contactEmail: null,
      address: { ...validAddress, province: 'BC', postalCode: 'V6B 1A1' },
      period,
      riding: defunctRiding,
      duplicateContributionCandidates: [],
      duplicateContactCandidates: [],
      overLimit: null,
    });
    const refs = findings.map((f) => f.ruleRef).sort();
    // B1 (out of province) and C3 (postal code outside Ontario's range) both
    // fire off the same BC address; C4 fires because 'Anonymous' is a single
    // word, on top of B3 firing for the same name being a known placeholder.
    expect(refs).toEqual(['A3', 'A4', 'B1', 'B3', 'C3', 'C4']);
  });
});
