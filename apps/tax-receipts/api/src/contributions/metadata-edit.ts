import type { GpoMetadataDescriptive } from '@gpo/tax-receipts-core';
import { withChangeLog } from '../changelog/write.js';
import { runValidationForContribution } from '../validation/run.js';
import { descriptiveToColumns, isReceiptedOrReported } from './metadata-cache.js';
import type { Contribution, PrismaClient } from '../generated/prisma/index.js';

/**
 * Contribution metadata edit (ticket 1.2, reworked for D12). The tool owns
 * contributions, so an edit is one local, change-logged transaction with no
 * Qomon call and therefore no write-first failure mode: the whole
 * descriptive object replaces the contribution's descriptive columns, `external_ref` (which lives on the
 * payment) is written to the payment, and every change carries the actor's
 * reason (invariant 5).
 *
 * A contribution already backing an ISSUED receipt or an RTD filing changes
 * only through a correction action (invariant 6, corrections.md), never a
 * plain edit.
 */

export class ContributionNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(contributionId: string) {
    super(`no contribution ${contributionId}`);
    this.name = 'ContributionNotFoundError';
  }
}

export class MetadataWriteBlockedError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'MetadataWriteBlockedError';
  }
}

export interface MetadataEditInput {
  contributionId: string;
  actorUserId: string;
  /** mandatory (invariant 5); a blank reason fails before any write. */
  reason: string;
  /** the WHOLE descriptive object. */
  descriptive: GpoMetadataDescriptive;
}

export async function editContributionMetadata(
  deps: { prisma: PrismaClient },
  input: MetadataEditInput,
): Promise<Contribution> {
  const { prisma } = deps;

  const contribution = await prisma.contribution.findUnique({
    where: { id: input.contributionId },
    include: { payment: true },
  });
  if (!contribution) throw new ContributionNotFoundError(input.contributionId);

  if (contribution.status !== 'ACTIVE') {
    throw new MetadataWriteBlockedError(
      `this contribution is ${contribution.status}; edit the row that replaced it instead`,
    );
  }
  if (await isReceiptedOrReported(prisma, contribution.id)) {
    throw new MetadataWriteBlockedError(
      'this contribution backs an issued receipt or an RTD filing; edit it through a correction action instead',
    );
  }

  const updated = await withChangeLog(
    prisma,
    { userId: input.actorUserId, reason: input.reason },
    async (ctx) => {
      const { payment: _payment, ...before } = contribution;
      const after = await ctx.tx.contribution.update({
        where: { id: contribution.id },
        data: descriptiveToColumns(input.descriptive),
      });
      await ctx.log({
        subjectType: 'Contribution',
        subjectId: contribution.id,
        before,
        after,
      });

      // `external_ref` is the processor id on the payment (D12), not a
      // metadata column: keep it in step when the edit changes it.
      if (input.descriptive.external_ref !== contribution.payment.externalRef) {
        const payment = await ctx.tx.payment.update({
          where: { id: contribution.paymentId },
          data: { externalRef: input.descriptive.external_ref },
        });
        await ctx.log({
          subjectType: 'Payment',
          subjectId: payment.id,
          before: contribution.payment,
          after: payment,
        });
      }
      return after;
    },
  );

  // "on edit, all rules against the changed row" (validation-rules.md)
  await runValidationForContribution(prisma, contribution.id);

  return updated;
}
