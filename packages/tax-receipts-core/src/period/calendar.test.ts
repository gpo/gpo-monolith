import { describe, expect, it } from 'vitest';
import {
  AmbiguousPeriodError,
  InvalidPeriodBoundsError,
  contributionYear,
  etIsoDate,
  formatEoDate,
  resolvePeriod,
  type PeriodRow,
} from './calendar.js';

/**
 * Modelling note: the ANNUAL period row spans the whole calendar year; the
 * GENERAL_ELECTION / BY_ELECTION writ periods overlay it, and precedence makes
 * the election period win for instants inside the writ. This reproduces the
 * filed 2025 shape (63 annual, 64 GE spanning Jan 27 to May 27) without
 * needing non-contiguous rows.
 */
/** Explicit UTC instant. ET wall-clock boundaries are written with their
 *  offset spelled out (EST is UTC-5, EDT is UTC-4). */
function utc(iso: string): Date {
  return new Date(iso);
}

const period63: PeriodRow = {
  id: 63,
  name: '2025 Annual',
  kind: 'ANNUAL',
  ridingNumbers: [],
  // 2025-01-01T00:00 ET == 05:00Z (EST, UTC-5)
  startsAt: utc('2025-01-01T05:00:00Z'),
  // 2026-01-01T00:00 ET == 05:00Z
  endsAt: utc('2026-01-01T05:00:00Z'),
};

const period64: PeriodRow = {
  id: 64,
  name: '2025 General Election',
  kind: 'GENERAL_ELECTION',
  ridingNumbers: [],
  // 2025-01-27T00:00 ET == 05:00Z
  startsAt: utc('2025-01-27T05:00:00Z'),
  // 2025-05-28T00:00 ET == 04:00Z (EDT, UTC-4) -> May 27 inclusive
  endsAt: utc('2025-05-28T04:00:00Z'),
};

const period67: PeriodRow = {
  id: 67,
  name: '2026 Annual',
  kind: 'ANNUAL',
  ridingNumbers: [],
  startsAt: utc('2026-01-01T05:00:00Z'),
  endsAt: utc('2027-01-01T05:00:00Z'),
};

// A by-election in riding 84 during summer 2026.
const byElection: PeriodRow = {
  id: 70,
  name: 'HESC by-election',
  kind: 'BY_ELECTION',
  ridingNumbers: [84],
  startsAt: utc('2026-07-01T04:00:00Z'),
  endsAt: utc('2026-09-04T04:00:00Z'),
};

const allPeriods = [period63, period64, period67, byElection];

describe('resolvePeriod', () => {
  it('returns the annual period outside any writ', () => {
    const r = resolvePeriod(utc('2025-08-15T12:00:00Z'), allPeriods);
    expect(r?.id).toBe(63);
  });

  it('election period wins over the overlapping annual period', () => {
    const r = resolvePeriod(utc('2025-03-10T12:00:00Z'), allPeriods);
    expect(r?.id).toBe(64);
  });

  it('is minute-precise at the start boundary (inclusive)', () => {
    expect(resolvePeriod(period64.startsAt, allPeriods)?.id).toBe(64);
    const oneMinuteBefore = new Date(period64.startsAt.getTime() - 60_000);
    expect(resolvePeriod(oneMinuteBefore, allPeriods)?.id).toBe(63);
  });

  it('is minute-precise at the end boundary (exclusive)', () => {
    const oneMinuteBefore = new Date(period64.endsAt.getTime() - 60_000);
    expect(resolvePeriod(oneMinuteBefore, allPeriods)?.id).toBe(64);
    expect(resolvePeriod(period64.endsAt, allPeriods)?.id).toBe(63);
  });

  it('scopes by-elections to their riding', () => {
    const inWrit = utc('2026-08-01T12:00:00Z');
    expect(resolvePeriod(inWrit, allPeriods, { ridingNumber: 84 })?.id).toBe(70);
    // same instant, different riding: falls through to the 2026 annual period
    expect(resolvePeriod(inWrit, allPeriods, { ridingNumber: 12 })?.id).toBe(67);
    // party-level contribution: by-election is out of scope
    expect(resolvePeriod(inWrit, allPeriods, { ridingNumber: null })?.id).toBe(
      67,
    );
  });

  it('returns null when nothing matches (rule A1 flags it)', () => {
    expect(resolvePeriod(utc('2020-01-01T00:00:00Z'), allPeriods)).toBeNull();
  });

  it('throws on equal-precedence overlap rather than guessing', () => {
    const overlappingAnnual: PeriodRow = {
      ...period63,
      id: 999,
      name: 'duplicate annual',
    };
    expect(() =>
      resolvePeriod(utc('2025-08-15T12:00:00Z'), [
        period63,
        overlappingAnnual,
      ]),
    ).toThrow(AmbiguousPeriodError);
  });

  it('rejects inverted bounds', () => {
    const bad: PeriodRow = {
      ...period63,
      startsAt: utc('2025-06-01T00:00:00Z'),
      endsAt: utc('2025-01-01T00:00:00Z'),
    };
    expect(() => resolvePeriod(utc('2025-03-01T00:00:00Z'), [bad])).toThrow(
      InvalidPeriodBoundsError,
    );
  });

  it('handles a mid-cycle boundary revision (Period rows are editable)', () => {
    const revised: PeriodRow = {
      ...period64,
      endsAt: utc('2025-05-15T04:00:00Z'),
    };
    const may20 = utc('2025-05-20T12:00:00Z');
    expect(resolvePeriod(may20, [period63, period64])?.id).toBe(64);
    expect(resolvePeriod(may20, [period63, revised])?.id).toBe(63);
  });

  it('every instant across the year maps to exactly one in-scope period', () => {
    const periods = [period63, period64];
    for (let day = 0; day < 365; day += 1) {
      const instant = new Date(
        Date.UTC(2025, 0, 1, 12, 0, 0) + day * 86_400_000,
      );
      // must not throw, must be non-null (63 covers the whole year)
      const r = resolvePeriod(instant, periods);
      expect(r).not.toBeNull();
    }
  });
});

describe('ET calendar helpers', () => {
  it('rolls a post-midnight-UTC instant back to the prior ET day/year', () => {
    const instant = utc('2027-01-01T03:30:00Z'); // 2026-12-31 22:30 ET
    expect(contributionYear(instant)).toBe(2026);
    expect(etIsoDate(instant)).toBe('2026-12-31');
    expect(formatEoDate(instant)).toBe('12312026');
  });

  it('keeps a mid-day instant on the same ET date', () => {
    const instant = utc('2026-06-15T16:00:00Z'); // 12:00 ET (EDT)
    expect(contributionYear(instant)).toBe(2026);
    expect(etIsoDate(instant)).toBe('2026-06-15');
    expect(formatEoDate(instant)).toBe('06152026');
  });

  it('is correct across the spring DST transition', () => {
    // 2026-03-08 02:00 ET springs forward. 07:30Z is 02:30 EST -> 03:30 EDT.
    const instant = utc('2026-03-08T07:30:00Z');
    expect(etIsoDate(instant)).toBe('2026-03-08');
  });

  it('is correct across the fall DST transition', () => {
    // 2026-11-01 02:00 EDT falls back to 01:00 EST.
    const before = utc('2026-11-01T05:30:00Z'); // 01:30 EDT
    const after = utc('2026-11-01T06:30:00Z'); // 01:30 EST
    expect(etIsoDate(before)).toBe('2026-11-01');
    expect(etIsoDate(after)).toBe('2026-11-01');
  });
});
