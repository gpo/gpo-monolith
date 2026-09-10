import { ReceiptStatus, type ReceiptStatus as Status } from '../enums.js';
import { eligibleAmountCents } from '../money.js';
import { z } from 'zod';

/**
 * Allocation invariants 1 and 2 (data-model §2), also guarantee G1
 * ("no double counting"). These pure checks mirror the database triggers in
 * ticket 0.3; the service layer runs them before writing and the DB is the
 * backstop. Property-based tests (test-plan U2) exercise them directly.
 *
 * Invariant 1: for any contribution, the sum of its allocation amounts over
 *   ISSUED receipts is at most its eligible amount (total minus non-deductible).
 * Invariant 2: a receipt's total is derived from its allocations; a stored
 *   total is forbidden (enforced by the schema having no such column).
 */

export const AllocationRow = z.object({
  receiptId: z.string(),
  contributionId: z.string(),
  amountCents: z.number().int().min(1),
  receiptStatus: ReceiptStatus,
});
export type AllocationRow = z.infer<typeof AllocationRow>;

export interface ContributionAmounts {
  id: string;
  amountCents: number;
  nonDeductibleCents: number;
}

export interface AllocationSumViolation {
  contributionId: string;
  eligibleAmountCents: number;
  issuedAllocatedCents: number;
  overageCents: number;
}

/** Check invariant 1 for one contribution against all of its allocations. */
export function checkAllocationSum(
  contribution: ContributionAmounts,
  allocations: readonly AllocationRow[],
): AllocationSumViolation | null {
  const eligible = eligibleAmountCents(
    contribution.amountCents,
    contribution.nonDeductibleCents,
  );
  const issued = allocations
    .filter(
      (a) => a.contributionId === contribution.id && a.receiptStatus === 'ISSUED',
    )
    .reduce((sum, a) => sum + a.amountCents, 0);
  if (issued <= eligible) return null;
  return {
    contributionId: contribution.id,
    eligibleAmountCents: eligible,
    issuedAllocatedCents: issued,
    overageCents: issued - eligible,
  };
}

/** Check invariant 1 across a set of contributions. */
export function checkAllocationSums(
  contributions: readonly ContributionAmounts[],
  allocations: readonly AllocationRow[],
): AllocationSumViolation[] {
  const out: AllocationSumViolation[] = [];
  for (const c of contributions) {
    const v = checkAllocationSum(c, allocations);
    if (v) out.push(v);
  }
  return out;
}

/** Invariant 2: the derived total of a receipt is the sum of its allocations.
 *  Cancelled and void receipts still have a derived total (used as filed rows
 *  at full value, then filtered from aggregates: rule REP7). */
export function receiptTotalCents(
  allocations: readonly Pick<AllocationRow, 'amountCents'>[],
): number {
  return allocations.reduce((sum, a) => sum + a.amountCents, 0);
}

/** How much of a contribution's eligible amount is still unallocated by ISSUED
 *  receipts (what a new receipt may take). Never negative. */
export function remainingEligibleCents(
  contribution: ContributionAmounts,
  allocations: readonly AllocationRow[],
): number {
  const eligible = eligibleAmountCents(
    contribution.amountCents,
    contribution.nonDeductibleCents,
  );
  const issued = allocations
    .filter(
      (a) => a.contributionId === contribution.id && a.receiptStatus === 'ISSUED',
    )
    .reduce((sum, a) => sum + a.amountCents, 0);
  return Math.max(0, eligible - issued);
}

export function isTerminalReceiptStatus(status: Status): boolean {
  return status === 'CANCELLED' || status === 'VOID';
}
