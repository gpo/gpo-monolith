import {
  isTerminalReceiptStatus,
  remainingEligibleCents,
  type AllocationRow,
} from '@gpo/tax-receipts-core';
import { withChangeLog } from '../changelog/write.js';
import { ContributionNotFoundError } from '../contributions/metadata-edit.js';
import type { PrismaClient, ReceiptAllocation } from '../generated/prisma/index.js';
import { AllocationOverageError, ReceiptIssuanceValidationError } from './issue.js';

/**
 * Allocation model (ticket 3.2): the general-purpose "many" side of
 * `ReceiptAllocation`'s many-to-many. Ticket 3.1 only ever creates a receipt
 * and its one allocation together; nothing before this ticket could attach a
 * *second* contribution to an already-issued receipt, so the schema's
 * many-to-many was real in shape but never exercised as such. This is that
 * primitive: `allocateToReceipt` links one more contribution onto an
 * existing, still-ISSUED receipt, re-checking invariant 1 for that
 * contribution exactly the way `issueReceipt` does.
 *
 * What this deliberately does not do: decide which contribution's
 * `acceptedAt` or `goodsServices` value prints once a receipt backs more than
 * one contribution, or re-render the PDF to reflect the new total. Guessing
 * at that on a legal receipt is the same call ticket 3.1 already declined to
 * make (see `issue.ts`'s header comment); it belongs with the
 * correction/consolidation workflow (tickets 3.10/3.11) that will actually
 * reissue a new PDF once a receipt's contribution set changes.
 * `reports/load-receipts.ts`'s `MultiAllocationReceiptError` guard means such
 * a receipt can't be reported yet either, by the same design — expected,
 * not a bug this ticket needs to fix.
 */

export class ReceiptNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(readonly receiptId: string) {
    super(`receipt ${receiptId} not found`);
    this.name = 'ReceiptNotFoundError';
  }
}

/** Only an ISSUED receipt may gain a new allocation; a cancelled or void
 *  receipt is a closed record (invariant: nothing mutates a terminal
 *  receipt's contents). */
export class TerminalReceiptError extends Error {
  readonly statusCode = 409;
  constructor(readonly receiptId: string, readonly status: string) {
    super(`receipt ${receiptId} is ${status}; a terminal receipt cannot take a new allocation`);
    this.name = 'TerminalReceiptError';
  }
}

/** A receipt is one donor's document; allocating a different contact's
 *  contribution onto it isn't a case anything asks for (corrections.md's
 *  "move a contribution between donors" moves the *receipt*, it doesn't mix
 *  contacts on one). */
export class AllocationContactMismatchError extends Error {
  readonly statusCode = 400;
  constructor(readonly receiptId: string, readonly contributionId: string) {
    super(
      `contribution ${contributionId} belongs to a different contact than receipt ${receiptId}; ` +
        'a receipt cannot mix allocations from more than one donor',
    );
    this.name = 'AllocationContactMismatchError';
  }
}

export class DuplicateAllocationError extends Error {
  readonly statusCode = 409;
  constructor(readonly receiptId: string, readonly contributionId: string) {
    super(`contribution ${contributionId} is already allocated to receipt ${receiptId}`);
    this.name = 'DuplicateAllocationError';
  }
}

export interface AllocateToReceiptDeps {
  prisma: PrismaClient;
}

export interface AllocateToReceiptInput {
  receiptId: string;
  contributionId: string;
  actorUserId: string;
  /** mandatory (invariant 5). */
  reason: string;
  /** defaults to the contribution's full remaining eligible amount. */
  amountCents?: number;
}

export interface AllocatedReceipt {
  allocationId: string;
  amountCents: number;
  /** the receipt's new total, derived from all of its allocations
   *  (invariant 2) — never stored, always recomputed. */
  receiptTotalCents: number;
}

export async function allocateToReceipt(
  deps: AllocateToReceiptDeps,
  input: AllocateToReceiptInput,
): Promise<AllocatedReceipt> {
  const { prisma } = deps;

  const receipt = await prisma.receipt.findUnique({
    where: { id: input.receiptId },
    include: { allocations: true },
  });
  if (!receipt) throw new ReceiptNotFoundError(input.receiptId);
  if (isTerminalReceiptStatus(receipt.status)) {
    throw new TerminalReceiptError(receipt.id, receipt.status);
  }

  const contribution = await prisma.contribution.findUnique({
    where: { id: input.contributionId },
    include: { metadata: true, allocations: { include: { receipt: true } } },
  });
  if (!contribution) throw new ContributionNotFoundError(input.contributionId);
  if (!contribution.metadata) {
    throw new ReceiptIssuanceValidationError(
      `contribution ${input.contributionId} has no metadata yet; intake derivation has not resolved this row`,
    );
  }
  if (contribution.contactId !== receipt.contactId) {
    throw new AllocationContactMismatchError(receipt.id, contribution.id);
  }
  if (receipt.allocations.some((a) => a.contributionId === contribution.id)) {
    throw new DuplicateAllocationError(receipt.id, contribution.id);
  }

  const allocationRows: AllocationRow[] = contribution.allocations.map((a) => ({
    receiptId: a.receiptId,
    contributionId: a.contributionId,
    amountCents: a.amountCents,
    receiptStatus: a.receipt.status,
  }));
  const remaining = remainingEligibleCents(
    {
      id: contribution.id,
      amountCents: contribution.amountCents,
      nonDeductibleCents: contribution.metadata.nonDeductibleCents,
    },
    allocationRows,
  );
  const amountCents = input.amountCents ?? remaining;
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new ReceiptIssuanceValidationError('amountCents must be a positive integer number of cents');
  }
  if (amountCents > remaining) {
    throw new AllocationOverageError(remaining, amountCents);
  }

  const allocation: ReceiptAllocation = await withChangeLog(
    prisma,
    { userId: input.actorUserId, reason: input.reason },
    async (ctx) => {
      const created = await ctx.tx.receiptAllocation.create({
        data: { receiptId: receipt.id, contributionId: contribution.id, amountCents },
      });
      await ctx.log({
        subjectType: 'ReceiptAllocation',
        subjectId: created.id,
        after: created,
      });
      return created;
    },
  );

  return {
    allocationId: allocation.id,
    amountCents,
    receiptTotalCents: receipt.allocations.reduce((sum, a) => sum + a.amountCents, 0) + amountCents,
  };
}
