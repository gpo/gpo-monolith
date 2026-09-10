import { DateTime } from 'luxon';
import { z } from 'zod';
import { ET_ZONE, etIsoDate } from '../period/calendar.js';

/**
 * RTD business-day clock (ticket 0.10). "Within 15 business days of deposit"
 * (s. 34.1). Business days exclude weekends and the nine ESA public holidays
 * (eo-reporting.md §1).
 *
 * The holiday list is ANNUAL CONFIGURATION, not code (U5): the tool stores a
 * `BusinessDayCalendar` row per year and this module evaluates against it. See
 * `standardOntarioEsaHolidays` for the generator used to seed a year; once
 * seeded, a year's dates are editable data (statutory holidays can be moved,
 * and EO's list is authoritative).
 */

export const RTD_BUSINESS_DAYS = 15;
export const RTD_WARN_DAYS_REMAINING = 5;

export const BusinessDayCalendar = z.object({
  year: z.number().int(),
  /** ET calendar dates, ISO `YYYY-MM-DD`. */
  holidays: z.array(z.string().date()),
});
export type BusinessDayCalendar = z.infer<typeof BusinessDayCalendar>;

/** A day-granularity clock built from one or more annual calendars. */
export class BusinessDayClock {
  private readonly holidays: Set<string>;

  constructor(calendars: readonly BusinessDayCalendar[]) {
    this.holidays = new Set();
    for (const cal of calendars) {
      for (const d of cal.holidays) this.holidays.add(d);
    }
  }

  private static startOfEtDay(input: Date | string): DateTime {
    const dt =
      typeof input === 'string'
        ? DateTime.fromISO(input, { zone: ET_ZONE })
        : DateTime.fromJSDate(input, { zone: ET_ZONE });
    return dt.startOf('day');
  }

  private isBusinessDayDt(dt: DateTime): boolean {
    const weekday = dt.weekday; // 1..7, 6=Sat 7=Sun
    if (weekday === 6 || weekday === 7) return false;
    return !this.holidays.has(dt.toISODate()!);
  }

  isHoliday(input: Date | string): boolean {
    const iso = typeof input === 'string' ? input : etIsoDate(input);
    return this.holidays.has(iso);
  }

  isBusinessDay(input: Date | string): boolean {
    return this.isBusinessDayDt(BusinessDayClock.startOfEtDay(input));
  }

  /** Add `n` business days to an ET calendar date. `n` may be 0. */
  addBusinessDays(input: Date | string, n: number): string {
    if (!Number.isInteger(n) || n < 0) {
      throw new RangeError(`addBusinessDays expects a non-negative integer, got ${n}`);
    }
    let cur = BusinessDayClock.startOfEtDay(input);
    let added = 0;
    while (added < n) {
      cur = cur.plus({ days: 1 });
      if (this.isBusinessDayDt(cur)) added += 1;
    }
    return cur.toISODate()!;
  }

  /** Count of business days in the half-open ET-date range `(from, to]`
   *  (the deposit day itself is day 0). Negative if `to` precedes `from`. */
  businessDaysBetween(from: Date | string, to: Date | string): number {
    let a = BusinessDayClock.startOfEtDay(from);
    let b = BusinessDayClock.startOfEtDay(to);
    if (a.toMillis() === b.toMillis()) return 0;
    const sign = b > a ? 1 : -1;
    if (sign < 0) [a, b] = [b, a];
    let count = 0;
    let cur = a;
    while (cur < b) {
      cur = cur.plus({ days: 1 });
      if (this.isBusinessDayDt(cur)) count += 1;
    }
    return count * sign;
  }

  /**
   * The RTD due date for a deposit: {@link RTD_BUSINESS_DAYS} business days
   * after the deposit's ET calendar date. Returns an ISO `YYYY-MM-DD` string.
   */
  rtdDueDate(depositInstant: Date | string): string {
    return this.addBusinessDays(depositInstant, RTD_BUSINESS_DAYS);
  }

  /** Business days between `asOf` and the due date. 0 on the due date,
   *  negative once overdue. Drives the dashboard warning at
   *  {@link RTD_WARN_DAYS_REMAINING}. */
  businessDaysRemaining(dueDate: string, asOf: Date | string): number {
    return this.businessDaysBetween(asOf, dueDate);
  }

  /**
   * A filing is late if submitted after the due date of its earliest deposit
   * (eo-reporting.md §1). Compared on ET calendar dates: submitting any time
   * on the due date is on time.
   */
  isFilingLate(
    submittedInstant: Date | string,
    earliestDepositInstant: Date | string,
  ): boolean {
    const due = this.rtdDueDate(earliestDepositInstant);
    const submittedDate =
      typeof submittedInstant === 'string'
        ? submittedInstant
        : etIsoDate(submittedInstant);
    return submittedDate > due;
  }
}

/**
 * Generate the nine Ontario ESA statutory holidays for a calendar year, as ET
 * ISO dates. Used ONLY to seed a `BusinessDayCalendar`; runtime evaluation
 * reads the stored (editable) dates. Good Friday needs Easter, computed with
 * the Anonymous Gregorian algorithm.
 */
export function standardOntarioEsaHolidays(year: number): string[] {
  const iso = (m: number, d: number) =>
    `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const nthWeekdayOfMonth = (month: number, weekday: number, n: number) => {
    let dt = DateTime.fromObject({ year, month, day: 1 }, { zone: ET_ZONE });
    let found = 0;
    while (true) {
      if (dt.weekday === weekday) {
        found += 1;
        if (found === n) return dt.toISODate()!;
      }
      dt = dt.plus({ days: 1 });
    }
  };

  const mondayBefore = (month: number, day: number) => {
    let dt = DateTime.fromObject({ year, month, day }, { zone: ET_ZONE });
    dt = dt.minus({ days: 1 });
    while (dt.weekday !== 1) dt = dt.minus({ days: 1 });
    return dt.toISODate()!;
  };

  // Easter Sunday (Anonymous Gregorian algorithm).
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easterMonth = Math.floor((h + l - 7 * m + 114) / 31);
  const easterDay = ((h + l - 7 * m + 114) % 31) + 1;
  const goodFriday = DateTime.fromObject(
    { year, month: easterMonth, day: easterDay },
    { zone: ET_ZONE },
  )
    .minus({ days: 2 })
    .toISODate()!;

  return [
    iso(1, 1), // New Year's Day
    nthWeekdayOfMonth(2, 1, 3), // Family Day: 3rd Monday of February
    goodFriday, // Good Friday
    mondayBefore(5, 25), // Victoria Day: Monday before May 25
    iso(7, 1), // Canada Day
    nthWeekdayOfMonth(9, 1, 1), // Labour Day: 1st Monday of September
    nthWeekdayOfMonth(10, 1, 2), // Thanksgiving: 2nd Monday of October
    iso(12, 25), // Christmas Day
    iso(12, 26), // Boxing Day
  ].sort();
}
