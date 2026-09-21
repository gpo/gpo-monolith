import { describe, expect, it } from 'vitest';
import { standardOntarioEsaHolidays } from './business-days.js';
import { BusinessDayClock } from './business-days.js';
import {
  RTD_DISCLOSURE_THRESHOLD_CENTS,
  attachRtdClock,
  buildRtdDraftRows,
  type RtdCandidateContribution,
} from './draft.js';

function candidate(overrides: Partial<RtdCandidateContribution> = {}): RtdCandidateContribution {
  return {
    contributionId: 'c1',
    contactId: 'donor-1',
    amountCents: 10_000,
    acceptedAt: new Date('2026-03-01T12:00:00Z'),
    alreadyReported: false,
    ...overrides,
  };
}

describe('buildRtdDraftRows (ticket 2.2)', () => {
  it('excludes deposits until the calendar-year aggregate exceeds $200', () => {
    const rows = buildRtdDraftRows([
      candidate({ contributionId: 'c1', amountCents: 10_000, acceptedAt: new Date('2026-03-01T12:00:00Z') }),
      candidate({ contributionId: 'c2', amountCents: 10_000, acceptedAt: new Date('2026-03-05T12:00:00Z') }),
    ]);
    // 100 + 100 = 200: exactly at the threshold, not over it.
    expect(rows).toHaveLength(0);
  });

  it('includes the deposit that first pushes the aggregate over $200, with the running aggregate', () => {
    const rows = buildRtdDraftRows([
      candidate({ contributionId: 'c1', amountCents: 10_000, acceptedAt: new Date('2026-03-01T12:00:00Z') }),
      candidate({ contributionId: 'c2', amountCents: 10_001, acceptedAt: new Date('2026-03-05T12:00:00Z') }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      contributionId: 'c2',
      aggregateAfterCents: 20_001,
      contributionYear: 2026,
    });
  });

  it('once over threshold, every subsequent deposit is its own row', () => {
    const rows = buildRtdDraftRows([
      candidate({ contributionId: 'c1', amountCents: 15_000, acceptedAt: new Date('2026-03-01T12:00:00Z') }),
      candidate({ contributionId: 'c2', amountCents: 10_000, acceptedAt: new Date('2026-03-05T12:00:00Z') }),
      candidate({ contributionId: 'c3', amountCents: 500, acceptedAt: new Date('2026-03-10T12:00:00Z') }),
    ]);
    expect(rows.map((r) => r.contributionId)).toEqual(['c2', 'c3']);
    expect(rows.map((r) => r.aggregateAfterCents)).toEqual([25_000, 25_500]);
  });

  it('an already-reported deposit is never re-emitted as a row, but still counts toward the aggregate', () => {
    const rows = buildRtdDraftRows([
      candidate({
        contributionId: 'c1',
        amountCents: 25_000,
        acceptedAt: new Date('2026-03-01T12:00:00Z'),
        alreadyReported: true,
      }),
      candidate({ contributionId: 'c2', amountCents: 1_000, acceptedAt: new Date('2026-03-05T12:00:00Z') }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ contributionId: 'c2', aggregateAfterCents: 26_000 });
  });

  it('aggregates separately per contact', () => {
    const rows = buildRtdDraftRows([
      candidate({ contributionId: 'c1', contactId: 'donor-1', amountCents: 15_000 }),
      candidate({ contributionId: 'c2', contactId: 'donor-2', amountCents: 15_000 }),
    ]);
    expect(rows).toHaveLength(0);
  });

  it('resets the aggregate at the calendar-year boundary (ET)', () => {
    const rows = buildRtdDraftRows([
      candidate({
        contributionId: 'c1',
        amountCents: 15_000,
        // 2025-12-31 20:00 ET (2026-01-01 01:00 UTC) is still a 2025 deposit.
        acceptedAt: new Date('2026-01-01T01:00:00Z'),
      }),
      candidate({
        contributionId: 'c2',
        amountCents: 15_000,
        acceptedAt: new Date('2026-06-01T12:00:00Z'),
      }),
    ]);
    // Different calendar years: neither aggregate exceeds $200 on its own.
    expect(rows).toHaveLength(0);
  });

  it('sorts the returned rows chronologically across contacts, tie-broken by id', () => {
    const rows = buildRtdDraftRows([
      candidate({
        contributionId: 'later',
        contactId: 'donor-1',
        amountCents: 21_000,
        acceptedAt: new Date('2026-03-05T12:00:00Z'),
      }),
      candidate({
        contributionId: 'earlier',
        contactId: 'donor-2',
        amountCents: 21_000,
        acceptedAt: new Date('2026-03-01T12:00:00Z'),
      }),
    ]);
    expect(rows.map((r) => r.contributionId)).toEqual(['earlier', 'later']);
  });

  it('the $200 threshold constant matches s. 34.1', () => {
    expect(RTD_DISCLOSURE_THRESHOLD_CENTS).toBe(20_000);
  });
});

describe('attachRtdClock (ticket 2.2)', () => {
  const clock = new BusinessDayClock([{ year: 2026, holidays: standardOntarioEsaHolidays(2026) }]);

  it('attaches the RTD due date and business days remaining per row', () => {
    const rows = buildRtdDraftRows([
      candidate({ contributionId: 'c1', amountCents: 25_000, acceptedAt: new Date('2026-03-02T12:00:00Z') }),
    ]);
    const withClock = attachRtdClock(rows, clock, new Date('2026-03-04T12:00:00Z'));
    expect(withClock).toHaveLength(1);
    expect(withClock[0]!.dueDate).toBe(clock.rtdDueDate(new Date('2026-03-02T12:00:00Z')));
    expect(withClock[0]!.overdue).toBe(false);
    expect(withClock[0]!.businessDaysRemaining).toBeGreaterThan(0);
  });

  it('flags a row overdue once business days remaining goes negative', () => {
    const rows = buildRtdDraftRows([
      candidate({ contributionId: 'c1', amountCents: 25_000, acceptedAt: new Date('2026-01-05T12:00:00Z') }),
    ]);
    const withClock = attachRtdClock(rows, clock, new Date('2026-03-01T12:00:00Z'));
    expect(withClock[0]!.overdue).toBe(true);
    expect(withClock[0]!.businessDaysRemaining).toBeLessThan(0);
  });
});
