import { contributionYear } from '../period/calendar.js';
import type { BusinessDayClock } from './business-days.js';

/**
 * RTD draft builder (ticket 2.2): row inclusion plus running aggregates
 * (eo-reporting.md §1). Builds the set of contributions that belong in the
 * *next* RTD filing. It does not write anything: stamping the result into
 * `RtdInclusion` rows is ticket 2.3 (invariant 6), and turning it into an
 * actual CSV/pipe artifact is a later step (screens.md screen 9 groups
 * "export" and "the stamp step" after the draft builder, not into it).
 *
 * Row-inclusion rule (resolved from the 2026 EO spec AND confirmed against a
 * real filed `gpo_report` output, open-questions.md O18): a deposit is
 * disclosed once the contributor's post-deposit CALENDAR-YEAR aggregate of
 * monetary contributions to the party exceeds $200; every deposit after that
 * point is its own row, carrying the running aggregate as of that row. Only
 * new, previously unreported records go in a filing (eo-reporting.md §1), so
 * an already-reported deposit is never re-emitted as a row -- but it still
 * counts toward the aggregate, since the aggregate is over the whole year's
 * deposits regardless of report status.
 *
 * Scope of "deposit" here: monetary contributions accepted by the party
 * (`entityKind = PARTY`) -- RTD "covers monetary contributions to the
 * central party only" (eo-reporting.md §1) -- excluding G&S (not
 * cash-receipted) and non-`valid` Qomon transaction statuses
 * (unpaid/reimbursed/bank_error/other never landed as an accepted deposit).
 * The `valid`-only filter isn't spelled out verbatim in eo-reporting.md;
 * flagged as open-questions.md O42 rather than assumed silently. Both
 * filters are applied by the caller when assembling `RtdCandidateContribution`
 * rows (apps/tax-receipts/api/src/rtd/draft.ts) -- this module only does row
 * inclusion and aggregation over whatever candidate set it's given.
 */

/** $200, s. 34.1. A deposit is disclosed once the aggregate EXCEEDS this --
 *  exactly $200 does not, by itself, trigger a row. */
export const RTD_DISCLOSURE_THRESHOLD_CENTS = 20_000;

export interface RtdCandidateContribution {
  contributionId: string;
  contactId: string;
  amountCents: number;
  acceptedAt: Date;
  /** true once an `RtdInclusion` row already exists for this contribution
   *  (any filing) -- still counts toward the running aggregate, but is never
   *  re-included as a row (only-new-records rule, eo-reporting.md §1). */
  alreadyReported: boolean;
}

export interface RtdDraftRow {
  contributionId: string;
  contactId: string;
  amountCents: number;
  acceptedAt: Date;
  contributionYear: number;
  /** contributor's calendar-year aggregate after this deposit, across ALL of
   *  the year's monetary party deposits (reported or not) up to and
   *  including this one. */
  aggregateAfterCents: number;
}

/**
 * Row inclusion + running aggregates. Pure and deterministic: groups by
 * (contact, calendar year), walks each group in acceptance-date order, and
 * emits a row for every unreported deposit once the group's cumulative
 * aggregate exceeds the disclosure threshold. The returned rows are sorted
 * chronologically across all contacts (filing order; a filing is late based
 * on its EARLIEST deposit, eo-reporting.md §1, so callers need that order).
 */
export function buildRtdDraftRows(
  contributions: readonly RtdCandidateContribution[],
): RtdDraftRow[] {
  const groups = new Map<string, RtdCandidateContribution[]>();
  for (const c of contributions) {
    const key = `${c.contactId}:${contributionYear(c.acceptedAt)}`;
    const group = groups.get(key);
    if (group) group.push(c);
    else groups.set(key, [c]);
  }

  const rows: RtdDraftRow[] = [];
  for (const group of groups.values()) {
    const ordered = [...group].sort(byAcceptedAtThenId);
    let aggregateCents = 0;
    for (const c of ordered) {
      aggregateCents += c.amountCents;
      if (aggregateCents > RTD_DISCLOSURE_THRESHOLD_CENTS && !c.alreadyReported) {
        rows.push({
          contributionId: c.contributionId,
          contactId: c.contactId,
          amountCents: c.amountCents,
          acceptedAt: c.acceptedAt,
          contributionYear: contributionYear(c.acceptedAt),
          aggregateAfterCents: aggregateCents,
        });
      }
    }
  }

  return rows.sort(byAcceptedAtThenId);
}

function byAcceptedAtThenId(
  a: { acceptedAt: Date; contributionId: string },
  b: { acceptedAt: Date; contributionId: string },
): number {
  return a.acceptedAt.getTime() - b.acceptedAt.getTime() || a.contributionId.localeCompare(b.contributionId);
}

export interface RtdDraftRowWithClock extends RtdDraftRow {
  /** ISO `YYYY-MM-DD`, 15 business days after `acceptedAt` (business-days.ts's
   *  clock, ticket 0.10). */
  dueDate: string;
  /** 0 on the due date, negative once overdue -- drives the screen 9 warning
   *  at `RTD_WARN_DAYS_REMAINING`. */
  businessDaysRemaining: number;
  overdue: boolean;
}

/** Attaches the ticket 0.10 business-day clock to each draft row
 *  (screens.md screen 9: "unreported over-threshold rows with per-row
 *  business days remaining"). Kept separate from {@link buildRtdDraftRows}
 *  so the row-inclusion/aggregate logic stays pure and clock-free. */
export function attachRtdClock(
  rows: readonly RtdDraftRow[],
  clock: BusinessDayClock,
  asOf: Date,
): RtdDraftRowWithClock[] {
  return rows.map((row) => {
    const dueDate = clock.rtdDueDate(row.acceptedAt);
    const businessDaysRemaining = clock.businessDaysRemaining(dueDate, asOf);
    return { ...row, dueDate, businessDaysRemaining, overdue: businessDaysRemaining < 0 };
  });
}
