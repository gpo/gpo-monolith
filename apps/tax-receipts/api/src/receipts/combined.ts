import type { EntityKind, ReceivedBy } from '../generated/prisma/index.js';

/**
 * Combined receipts (EO evaluation rows 43 and 46, O44): one receipt backed by
 * several contributions, each still its own `ReceiptAllocation`. This module
 * is the one answer to "what does such a receipt print and report", shared by
 * every path that renders or reports a receipt (issue, reissue, reprint,
 * correction reissue, the ALL/S2P2 loader), so they cannot drift apart.
 *
 * The answer (decided 2026-10-09):
 * - the receipt prints the acceptance dates as a range, first to last (a
 *   single date when they are all the same day);
 * - the ALL report carries one row per receipt, dated to the latest
 *   acceptance date, with the receipt's total;
 * - everything else printed or reported once per receipt (contribution type,
 *   agency status, entity, leadership contestant, period, donor) must agree
 *   across the contributions, so there is never a value to choose. Issuance
 *   refuses a combination that would need one (`combinationConflicts`).
 */

/** The contribution fields a receipt prints or reports once. */
export interface CombinableContribution {
  id: string;
  contactId: string;
  periodId: number | null;
  entityKind: EntityKind;
  ridingNumber: number | null;
  leadershipContestantId: string | null;
  receivedBy: ReceivedBy;
  goodsServices: boolean;
  acceptedAt: Date;
  eoContributorId: string | null;
}

const MUST_AGREE: { field: keyof CombinableContribution; label: string }[] = [
  { field: 'contactId', label: 'contributor' },
  { field: 'periodId', label: 'contribution period' },
  { field: 'entityKind', label: 'political entity' },
  { field: 'ridingNumber', label: 'riding' },
  { field: 'leadershipContestantId', label: 'leadership contestant' },
  { field: 'receivedBy', label: 'agency status (who received it)' },
  { field: 'goodsServices', label: 'contribution type (monetary or goods and services)' },
];

/** Why these contributions cannot share one receipt, as readable labels;
 *  empty when they can. Two different non-null EO contributor ids also
 *  conflict (a missing one does not). */
export function combinationConflicts(contributions: readonly CombinableContribution[]): string[] {
  const conflicts = MUST_AGREE.filter(
    ({ field }) => new Set(contributions.map((c) => String(c[field]))).size > 1,
  ).map(({ label }) => label);
  const eoIds = new Set(contributions.map((c) => c.eoContributorId).filter((id) => id !== null));
  if (eoIds.size > 1) conflicts.push('EO contributor id');
  return conflicts;
}

export interface ReceiptPrintedFields {
  /** earliest acceptance date */
  acceptedFrom: Date;
  /** latest acceptance date: the ALL report's deposit date */
  acceptedThrough: Date;
  goodsServices: boolean;
  eoContributorId: string | null;
  /** the earliest contribution, for the fields every contribution shares
   *  (entity, contestant) */
  primary: CombinableContribution;
}

/** What a receipt backed by these contributions prints once. Assumes they
 *  agree (`combinationConflicts` is empty); a receipt only counts as goods and
 *  services when every contribution on it is. */
export function receiptPrintedFields<C extends CombinableContribution>(
  contributions: readonly C[],
): ReceiptPrintedFields & { primary: C } {
  if (contributions.length === 0) throw new Error('a receipt needs at least one contribution');
  const byDate = [...contributions].sort((a, b) => a.acceptedAt.getTime() - b.acceptedAt.getTime());
  return {
    acceptedFrom: byDate[0]!.acceptedAt,
    acceptedThrough: byDate[byDate.length - 1]!.acceptedAt,
    goodsServices: contributions.every((c) => c.goodsServices),
    eoContributorId: contributions.find((c) => c.eoContributorId !== null)?.eoContributorId ?? null,
    primary: byDate[0]!,
  };
}
