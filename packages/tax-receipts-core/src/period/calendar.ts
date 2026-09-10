import { DateTime } from 'luxon';
import { z } from 'zod';
import { PeriodKind } from '../enums.js';

/**
 * Period calendar service (ticket 0.6).
 *
 * Time semantics (data-model §2 "Time semantics"): all instants are stored in
 * UTC; all EO-facing evaluation is in America/Toronto (ET). Period boundaries
 * are minute-precision ET wall-clock times, persisted as the equivalent UTC
 * instant. Containment is evaluated on the instant, so it is DST-correct for
 * free; ET only matters when we need the *calendar date* or *calendar year* of
 * an instant (aggregation for RTD and limits, dates rendered into EO files).
 */

export const ET_ZONE = 'America/Toronto';

export const PeriodRow = z.object({
  id: z.number().int(),
  name: z.string(),
  kind: PeriodKind,
  /** By-election periods are scoped to one or more ridings; empty for the
   *  party-wide ANNUAL and GENERAL_ELECTION periods (data-model §2 Period). */
  ridingNumbers: z.array(z.number().int().min(1).max(124)).default([]),
  /** Half-open interval [startsAt, endsAt). Minute precision supported. */
  startsAt: z.date(),
  endsAt: z.date(),
});
export type PeriodRow = z.infer<typeof PeriodRow>;

export class AmbiguousPeriodError extends Error {
  constructor(
    readonly instant: Date,
    readonly candidateIds: number[],
    readonly ridingNumber: number | null,
  ) {
    super(
      `contribution at ${instant.toISOString()} (riding ${
        ridingNumber ?? 'party'
      }) matches multiple periods of equal precedence: ${candidateIds.join(', ')}`,
    );
    this.name = 'AmbiguousPeriodError';
  }
}

export class InvalidPeriodBoundsError extends Error {
  constructor(readonly period: PeriodRow) {
    super(
      `period ${period.id} (${period.name}) has endsAt <= startsAt: ` +
        `${period.startsAt.toISOString()}..${period.endsAt.toISOString()}`,
    );
    this.name = 'InvalidPeriodBoundsError';
  }
}

function contains(period: PeriodRow, instant: Date): boolean {
  const t = instant.getTime();
  return t >= period.startsAt.getTime() && t < period.endsAt.getTime();
}

/** Election periods (writ periods carved out of the annual period) win over
 *  the ANNUAL period for the same instant. */
function precedence(kind: PeriodKind): number {
  switch (kind) {
    case 'GENERAL_ELECTION':
    case 'BY_ELECTION':
      return 1;
    case 'ANNUAL':
      return 0;
  }
}

export interface ResolvePeriodOptions {
  /** The contribution's directed-to riding, needed to scope by-elections.
   *  `null` means party-level (no riding). */
  ridingNumber?: number | null;
}

/**
 * Resolve the single EO period a contribution's acceptance instant belongs to,
 * or `null` when nothing matches (the caller flags this: rule A1).
 *
 * Guarantees "every timestamp maps to exactly one period per scope": if two
 * periods of equal precedence both contain the instant and both are in scope,
 * this throws {@link AmbiguousPeriodError} rather than guessing.
 */
export function resolvePeriod(
  instant: Date,
  periods: readonly PeriodRow[],
  options: ResolvePeriodOptions = {},
): PeriodRow | null {
  const ridingNumber = options.ridingNumber ?? null;

  for (const p of periods) {
    if (p.endsAt.getTime() <= p.startsAt.getTime()) {
      throw new InvalidPeriodBoundsError(p);
    }
  }

  const inScope = periods.filter((p) => {
    if (!contains(p, instant)) return false;
    if (p.kind === 'BY_ELECTION') {
      return ridingNumber !== null && p.ridingNumbers.includes(ridingNumber);
    }
    return true;
  });

  if (inScope.length === 0) return null;

  const maxPrecedence = Math.max(...inScope.map((p) => precedence(p.kind)));
  const top = inScope.filter((p) => precedence(p.kind) === maxPrecedence);

  if (top.length > 1) {
    throw new AmbiguousPeriodError(
      instant,
      top.map((p) => p.id),
      ridingNumber,
    );
  }
  return top[0]!;
}

function etDateTime(instant: Date): DateTime {
  return DateTime.fromJSDate(instant, { zone: ET_ZONE });
}

export interface EtDateParts {
  year: number;
  month: number;
  day: number;
}

/** The ET calendar date of a UTC instant. */
export function etDateParts(instant: Date): EtDateParts {
  const dt = etDateTime(instant);
  return { year: dt.year, month: dt.month, day: dt.day };
}

/**
 * The calendar year a contribution counts toward, evaluated in ET
 * (data-model §2): a deposit at 2027-01-01 03:30 UTC is a 2026 contribution.
 */
export function contributionYear(instant: Date): number {
  return etDateTime(instant).year;
}

/** ET calendar date as an ISO `YYYY-MM-DD` string. */
export function etIsoDate(instant: Date): string {
  return etDateTime(instant).toISODate()!;
}

/**
 * `MMDDYYYY` date as rendered into EO files (eo-reporting.md; verified against
 * the filed 2025 artifacts). Uses the ET calendar date. Later phases build the
 * full EO formatters on top of this; it lives here because the period calendar
 * owns "what ET date is this instant".
 */
export function formatEoDate(instant: Date): string {
  const { year, month, day } = etDateParts(instant);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${mm}${dd}${year}`;
}
