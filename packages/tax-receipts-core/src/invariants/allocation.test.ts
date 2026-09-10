import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  checkAllocationSum,
  receiptTotalCents,
  remainingEligibleCents,
  type AllocationRow,
} from './allocation.js';

const contribution = { id: 'c1', amountCents: 10_000, nonDeductibleCents: 2_500 };
// eligible = 7_500

function alloc(over: Partial<AllocationRow>): AllocationRow {
  return {
    receiptId: 'r1',
    contributionId: 'c1',
    amountCents: 1_000,
    receiptStatus: 'ISSUED',
    ...over,
  };
}

describe('checkAllocationSum (invariant 1 / G1)', () => {
  it('passes when issued allocations equal the eligible amount', () => {
    const allocations = [alloc({ amountCents: 5_000 }), alloc({ amountCents: 2_500, receiptId: 'r2' })];
    expect(checkAllocationSum(contribution, allocations)).toBeNull();
  });

  it('fails when issued allocations exceed the eligible amount', () => {
    const allocations = [alloc({ amountCents: 5_000 }), alloc({ amountCents: 3_000, receiptId: 'r2' })];
    const v = checkAllocationSum(contribution, allocations);
    expect(v?.overageCents).toBe(500);
  });

  it('ignores cancelled and void allocations (numbers retained, dollars freed)', () => {
    const allocations = [
      alloc({ amountCents: 7_500, receiptId: 'r1', receiptStatus: 'CANCELLED' }),
      alloc({ amountCents: 7_500, receiptId: 'r2', receiptStatus: 'ISSUED' }),
    ];
    expect(checkAllocationSum(contribution, allocations)).toBeNull();
  });

  it('ignores allocations for other contributions', () => {
    const allocations = [alloc({ contributionId: 'other', amountCents: 9_999 })];
    expect(checkAllocationSum(contribution, allocations)).toBeNull();
  });
});

describe('receiptTotalCents (invariant 2)', () => {
  it('derives the total from allocations', () => {
    expect(receiptTotalCents([{ amountCents: 100 }, { amountCents: 250 }])).toBe(350);
  });
});

describe('property: no issue/cancel/reissue sequence over-allocates', () => {
  it('remaining eligible never goes negative and issued sum never exceeds eligible', () => {
    fc.assert(
      fc.property(
        fc.record({
          amountCents: fc.integer({ min: 1, max: 1_000_000 }),
          nonDeductibleCents: fc.integer({ min: 0, max: 1_000_000 }),
        }),
        fc.array(
          fc.record({
            take: fc.integer({ min: 1, max: 1_000_000 }),
            cancel: fc.boolean(),
          }),
          { maxLength: 40 },
        ),
        (amounts, ops) => {
          const c = {
            id: 'c1',
            amountCents: amounts.amountCents,
            nonDeductibleCents: Math.min(
              amounts.nonDeductibleCents,
              amounts.amountCents,
            ),
          };
          const allocations: AllocationRow[] = [];
          let seq = 0;
          for (const op of ops) {
            const remaining = remainingEligibleCents(c, allocations);
            const take = Math.min(op.take, remaining);
            if (take > 0) {
              seq += 1;
              allocations.push({
                receiptId: `r${seq}`,
                contributionId: 'c1',
                amountCents: take,
                receiptStatus: op.cancel ? 'CANCELLED' : 'ISSUED',
              });
            }
            // invariant holds after every step
            expect(checkAllocationSum(c, allocations)).toBeNull();
            expect(remainingEligibleCents(c, allocations)).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });
});
