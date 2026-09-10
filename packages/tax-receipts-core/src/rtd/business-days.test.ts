import { describe, expect, it } from 'vitest';
import {
  BusinessDayClock,
  standardOntarioEsaHolidays,
  type BusinessDayCalendar,
} from './business-days.js';

const cal = (year: number): BusinessDayCalendar => ({
  year,
  holidays: standardOntarioEsaHolidays(year),
});

const clock = new BusinessDayClock([cal(2025), cal(2026), cal(2027)]);

describe('standardOntarioEsaHolidays', () => {
  it('produces the nine ESA holidays with the right movable dates', () => {
    expect(standardOntarioEsaHolidays(2026)).toEqual([
      '2026-01-01', // New Year's Day
      '2026-02-16', // Family Day (3rd Monday Feb)
      '2026-04-03', // Good Friday
      '2026-05-18', // Victoria Day (Monday before May 25)
      '2026-07-01', // Canada Day
      '2026-09-07', // Labour Day (1st Monday Sep)
      '2026-10-12', // Thanksgiving (2nd Monday Oct)
      '2026-12-25', // Christmas Day
      '2026-12-26', // Boxing Day
    ]);
  });

  it('computes Good Friday for other years', () => {
    expect(standardOntarioEsaHolidays(2025)).toContain('2025-04-18');
    expect(standardOntarioEsaHolidays(2027)).toContain('2027-03-26');
  });
});

describe('BusinessDayClock', () => {
  it('treats weekends and holidays as non-business days', () => {
    expect(clock.isBusinessDay('2026-07-01')).toBe(false); // Canada Day (Wed)
    expect(clock.isBusinessDay('2026-07-04')).toBe(false); // Saturday
    expect(clock.isBusinessDay('2026-07-02')).toBe(true);
  });

  it('rtdDueDate skips weekends', () => {
    // Wed 2026-06-10 + 15 business days -> Wed 2026-07-01 is Canada Day, skip
    expect(clock.rtdDueDate('2026-06-10')).toBe('2026-07-02');
  });

  it('rtdDueDate skips a holiday that lands inside the window', () => {
    // deposit just before Labour Day weekend 2026 (Mon 2026-09-07)
    const withHoliday = clock.rtdDueDate('2026-08-24');
    // same span without treating Labour Day as a holiday would land one day earlier
    const noHolidayClock = new BusinessDayClock([{ year: 2026, holidays: [] }]);
    const withoutHoliday = noHolidayClock.rtdDueDate('2026-08-24');
    expect(new Date(withHoliday).getTime()).toBeGreaterThan(
      new Date(withoutHoliday).getTime(),
    );
  });

  it('addBusinessDays(0) returns the same ET date', () => {
    expect(clock.addBusinessDays('2026-06-15', 0)).toBe('2026-06-15');
  });

  it('accepts a UTC instant that is the prior ET day', () => {
    // 2026-06-16 02:00Z is 2026-06-15 22:00 ET
    const due = clock.rtdDueDate(new Date('2026-06-16T02:00:00Z'));
    expect(due).toBe(clock.rtdDueDate('2026-06-15'));
  });

  it('businessDaysBetween counts forward and backward symmetrically', () => {
    expect(clock.businessDaysBetween('2026-06-15', '2026-06-22')).toBe(5);
    expect(clock.businessDaysBetween('2026-06-22', '2026-06-15')).toBe(-5);
    expect(clock.businessDaysBetween('2026-06-15', '2026-06-15')).toBe(0);
  });

  it('businessDaysRemaining goes negative once overdue and warns at 5', () => {
    const due = clock.rtdDueDate('2026-06-10'); // 2026-07-02
    expect(clock.businessDaysRemaining(due, '2026-07-02')).toBe(0);
    expect(clock.businessDaysRemaining(due, '2026-07-06')).toBeLessThan(0);
    // Thu Jun 25 -> Thu Jul 2, minus Canada Day: Fri, Mon, Tue, Thu = 4
    expect(clock.businessDaysRemaining(due, '2026-06-25')).toBe(4);
    expect(clock.businessDaysRemaining(due, '2026-06-24')).toBe(5);
  });

  it('isFilingLate: on the due date is on time, the next day is late', () => {
    const deposit = '2026-06-10';
    const due = clock.rtdDueDate(deposit); // 2026-07-02
    expect(clock.isFilingLate(due, deposit)).toBe(false);
    expect(clock.isFilingLate('2026-07-03', deposit)).toBe(true);
  });

  it('isFilingLate keys off the earliest deposit in the batch', () => {
    const earliest = '2026-06-01';
    const due = clock.rtdDueDate(earliest);
    // a filing submitted after the earliest deposit's due date is late even if
    // later deposits in the same file are still within their own windows
    const dayAfter = clock.addBusinessDays(due, 1);
    expect(clock.isFilingLate(dayAfter, earliest)).toBe(true);
  });

  it('crosses the year boundary using next year holidays', () => {
    // deposit 2026-12-18, window runs through Christmas + Boxing Day + New Year
    const due = clock.rtdDueDate('2026-12-18');
    expect(clock.isBusinessDay(due)).toBe(true);
    expect(due > '2027-01-01').toBe(true);
  });
});
