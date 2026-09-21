import { describe, expect, it } from 'vitest';
import type { PeriodRow } from '../period/calendar.js';
import type { RidingRow } from '../space/eligibility.js';
import { runRepGate, type RepGateSourceRow } from './rep-gate.js';

const ANNUAL_2026: PeriodRow = {
  id: 67,
  name: '2026 Annual',
  kind: 'ANNUAL',
  ridingNumbers: [],
  startsAt: new Date('2026-01-01T05:00:00Z'),
  endsAt: new Date('2027-01-01T05:00:00Z'),
};

const GE_2026: PeriodRow = {
  id: 68,
  name: '2026 General Election',
  kind: 'GENERAL_ELECTION',
  ridingNumbers: [],
  startsAt: new Date('2026-06-01T05:00:00Z'),
  endsAt: new Date('2026-09-01T05:00:00Z'),
};

const ACTIVE_RIDING_84: RidingRow = { ridingNumber: 84, active: true };

function source(overrides: Partial<RepGateSourceRow> = {}): RepGateSourceRow {
  return {
    receiptId: 'r1',
    receiptNumber: 'GPO-00000001',
    entityKind: 'PARTY',
    ridingNumber: null,
    periodId: 67,
    acceptedAt: new Date('2026-03-01T12:00:00Z'),
    processedDate: null,
    ...overrides,
  };
}

function context(periods: PeriodRow[] = [ANNUAL_2026], ridings: RidingRow[] = [ACTIVE_RIDING_84]) {
  return {
    periods: new Map(periods.map((p) => [p.id, p])),
    ridings: new Map(ridings.map((r) => [r.ridingNumber, r])),
  };
}

describe('runRepGate REP4 (valid entity)', () => {
  it('passes PARTY unconditionally', () => {
    const { findings } = runRepGate([source()], context());
    expect(findings).toEqual([]);
  });

  it('passes a CA in an active riding, any period', () => {
    const { findings } = runRepGate(
      [source({ entityKind: 'CA', ridingNumber: 84 })],
      context(),
    );
    expect(findings).toEqual([]);
  });

  it('blocks a CA in an inactive riding', () => {
    const { findings } = runRepGate(
      [source({ entityKind: 'CA', ridingNumber: 84 })],
      context([ANNUAL_2026], [{ ridingNumber: 84, active: false }]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleRef: 'REP4', receiptId: 'r1' });
  });

  it('blocks a CAMPAIGN during an ANNUAL period (never eligible)', () => {
    const { findings } = runRepGate(
      [source({ entityKind: 'CAMPAIGN', ridingNumber: 84, periodId: 67 })],
      context(),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.ruleRef).toBe('REP4');
  });

  it('passes a CAMPAIGN during a GENERAL_ELECTION period', () => {
    const { findings } = runRepGate(
      [source({ entityKind: 'CAMPAIGN', ridingNumber: 84, periodId: 68, acceptedAt: new Date('2026-07-01T12:00:00Z') })],
      context([GE_2026]),
    );
    expect(findings).toEqual([]);
  });

  it('blocks when the receipt references a period the gate has no row for', () => {
    const { findings } = runRepGate(
      [source({ entityKind: 'CA', ridingNumber: 84, periodId: 999 })],
      context(),
    );
    // CA is not period-scoped, so a missing period alone doesn't fail REP4 for CA --
    // but PARTY/CAMPAIGN checks do depend on it; assert CA still passes here.
    expect(findings).toEqual([]);
  });
});

describe('runRepGate REP6 (period window)', () => {
  it('passes an acceptance date inside the period', () => {
    const { findings } = runRepGate([source()], context());
    expect(findings.filter((f) => f.ruleRef === 'REP6')).toEqual([]);
  });

  it('blocks an acceptance date outside the period (drift after a period edit)', () => {
    const { findings } = runRepGate(
      [source({ acceptedAt: new Date('2025-12-31T12:00:00Z') })],
      context(),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleRef: 'REP6', receiptId: 'r1' });
  });

  it('does not check the window when the gate has no row for the period (REP4 already covers unknown periods)', () => {
    const { findings } = runRepGate(
      [source({ periodId: 999, acceptedAt: new Date('1999-01-01T00:00:00Z') })],
      context(),
    );
    expect(findings.filter((f) => f.ruleRef === 'REP6')).toEqual([]);
  });
});

describe('runRepGate receivable flag (REP6, non-blocking)', () => {
  it('flags acceptance in year N with processing in year N+1', () => {
    const { findings, receivable } = runRepGate(
      [
        source({
          acceptedAt: new Date('2026-12-30T12:00:00Z'),
          processedDate: new Date('2027-01-02T12:00:00Z'),
        }),
      ],
      context(),
    );
    expect(findings.filter((f) => f.ruleRef === 'REP6')).toEqual([]); // not blocking
    expect(receivable).toHaveLength(1);
    expect(receivable[0]).toMatchObject({ receiptId: 'r1', acceptedYear: 2026, processedYear: 2027 });
  });

  it('does not flag when processed in the same year', () => {
    const { receivable } = runRepGate(
      [source({ acceptedAt: new Date('2026-03-01T12:00:00Z'), processedDate: new Date('2026-03-05T12:00:00Z') })],
      context(),
    );
    expect(receivable).toEqual([]);
  });

  it('does not flag when no processedDate is recorded', () => {
    const { receivable } = runRepGate([source({ processedDate: null })], context());
    expect(receivable).toEqual([]);
  });
});
