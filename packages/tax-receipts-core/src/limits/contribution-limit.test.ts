import { describe, expect, it } from 'vitest';
import {
  evaluateLimits,
  type ContributionForLimits,
  type ContributionLimitRow,
} from './contribution-limit.js';

const YEAR = 2026;

// 2026 figures (O15): $5,000 party, ~$3,425 CA/campaign, ~$10,000 candidate-self.
const limits2026: ContributionLimitRow[] = [
  { year: YEAR, bucket: 'PARTY', amountCents: 500_000 },
  { year: YEAR, bucket: 'CA', amountCents: 342_500 },
  { year: YEAR, bucket: 'CAMPAIGN', amountCents: 342_500 },
  { year: YEAR, bucket: 'CANDIDATE_SELF', amountCents: 1_000_000 },
];

function c(over: Partial<ContributionForLimits>): ContributionForLimits {
  return {
    id: Math.random().toString(36).slice(2),
    amountCents: 10_000,
    goodsServices: false,
    entityKind: 'PARTY',
    ridingNumber: null,
    year: YEAR,
    candidateSelf: false,
    leadership: false,
    ...over,
  };
}

describe('evaluateLimits', () => {
  it('flags a donor over the party limit', () => {
    const contributions = [
      c({ entityKind: 'PARTY', amountCents: 400_000 }),
      c({ entityKind: 'PARTY', amountCents: 150_000 }),
    ];
    const r = evaluateLimits({ year: YEAR, limits: limits2026, contributions });
    expect(r.overLimit).toBe(true);
    const party = r.results.find((x) => x.bucket === 'PARTY')!;
    expect(party.aggregateCents).toBe(550_000);
    expect(party.overageCents).toBe(50_000);
  });

  it('aggregates monetary and G&S together', () => {
    const contributions = [
      c({ entityKind: 'CA', ridingNumber: 84, amountCents: 300_000 }),
      c({
        entityKind: 'CA',
        ridingNumber: 84,
        amountCents: 100_000,
        goodsServices: true,
      }),
    ];
    const r = evaluateLimits({ year: YEAR, limits: limits2026, contributions });
    const ca = r.results.find((x) => x.groupKey === 'ca:84')!;
    expect(ca.aggregateCents).toBe(400_000);
    expect(ca.overLimit).toBe(true);
  });

  it('keeps CA buckets separate per riding', () => {
    const contributions = [
      c({ entityKind: 'CA', ridingNumber: 84, amountCents: 300_000 }),
      c({ entityKind: 'CA', ridingNumber: 12, amountCents: 300_000 }),
    ];
    const r = evaluateLimits({ year: YEAR, limits: limits2026, contributions });
    expect(r.overLimit).toBe(false);
    expect(r.results.map((x) => x.groupKey).sort()).toEqual(['ca:12', 'ca:84']);
  });

  it('candidate-self contributions use the candidate-self bucket, not campaign', () => {
    const contributions = [
      c({
        entityKind: 'CAMPAIGN',
        ridingNumber: 84,
        amountCents: 900_000,
        candidateSelf: true,
      }),
    ];
    const r = evaluateLimits({ year: YEAR, limits: limits2026, contributions });
    const self = r.results.find((x) => x.bucket === 'CANDIDATE_SELF')!;
    expect(self.aggregateCents).toBe(900_000);
    expect(self.overLimit).toBe(false); // under the $10,000 self bucket
    expect(r.results.some((x) => x.bucket === 'CAMPAIGN')).toBe(false);
  });

  it('candidate-self exempts only the own campaign: a normal campaign gift still counts', () => {
    const contributions = [
      c({
        entityKind: 'CAMPAIGN',
        ridingNumber: 84,
        amountCents: 900_000,
        candidateSelf: true,
      }),
      c({ entityKind: 'CAMPAIGN', ridingNumber: 84, amountCents: 400_000 }),
    ];
    const r = evaluateLimits({ year: YEAR, limits: limits2026, contributions });
    const campaign = r.results.find((x) => x.bucket === 'CAMPAIGN')!;
    expect(campaign.aggregateCents).toBe(400_000);
    expect(campaign.overLimit).toBe(true);
  });

  it('is purely table-driven: removing a bucket row stops checking it', () => {
    const contributions = [c({ entityKind: 'PARTY', amountCents: 900_000 })];
    const withoutParty = limits2026.filter((l) => l.bucket !== 'PARTY');
    const r = evaluateLimits({
      year: YEAR,
      limits: withoutParty,
      contributions,
    });
    expect(r.overLimit).toBe(false);
    expect(r.results).toHaveLength(0);
  });

  it('is purely table-driven: re-pricing a bucket row changes the outcome', () => {
    const contributions = [c({ entityKind: 'PARTY', amountCents: 600_000 })];
    const higher = limits2026.map((l) =>
      l.bucket === 'PARTY' ? { ...l, amountCents: 700_000 } : l,
    );
    expect(
      evaluateLimits({ year: YEAR, limits: limits2026, contributions }).overLimit,
    ).toBe(true);
    expect(
      evaluateLimits({ year: YEAR, limits: higher, contributions }).overLimit,
    ).toBe(false);
  });

  it('only aggregates the requested year', () => {
    const contributions = [
      c({ entityKind: 'PARTY', amountCents: 400_000, year: 2025 }),
      c({ entityKind: 'PARTY', amountCents: 400_000, year: 2026 }),
    ];
    const r = evaluateLimits({ year: 2026, limits: limits2026, contributions });
    expect(r.results.find((x) => x.bucket === 'PARTY')!.aggregateCents).toBe(
      400_000,
    );
  });
});
