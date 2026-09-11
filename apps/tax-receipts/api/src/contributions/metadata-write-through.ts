import {
  buildMetadataEnvelope,
  computeMetadataChecksum,
  descriptiveChanged,
  type GpoMetadataDescriptive,
} from '@gpo/tax-receipts-core';
import type { QomonApi } from '@gpo/qomon-client';
import { withChangeLog } from '../changelog/write.js';
import { descriptiveToRow, isReceiptedOrReported } from './metadata-cache.js';
import type { ContributionMetadata, PrismaClient } from '../generated/prisma/index.js';

/**
 * Metadata write-through (ticket 1.2, data-model §5 "Tool edit (write-first,
 * Qomon is truth)", D4). Qomon is written to FIRST, in its entirety (no
 * partial merges — the checksum covers the whole descriptive object, so a
 * partial write would silently corrupt drift detection); only once Qomon
 * confirms does the cache/snapshot/change-log commit locally, in one
 * transaction. If the Qomon write fails, or its echo doesn't match what was
 * sent, nothing local changes and the edit is rejected, visibly.
 *
 * Crash-consistency: if the process dies between a confirmed Qomon write and
 * the local commit, nothing is lost — the next mirror sweep (1.1) reads
 * Qomon's now-current metadata back, finds the cached checksum stale, and
 * self-heals the cache through its own refresh path. That sweep-side entry
 * is attributed to the system actor, not the original edit's actor/reason;
 * accepted as the cost of write-first over a two-phase commit.
 */

export class ContributionNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(contributionId: string) {
    super(`no contribution ${contributionId}`);
    this.name = 'ContributionNotFoundError';
  }
}

/** Mirrors invariant 6 / the diff-queue principle (data-model §5): a
 *  contribution already backing an ISSUED receipt or an RTD filing changes
 *  only through the (Phase 3) correction workflow, never a plain edit. */
export class MetadataWriteBlockedError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'MetadataWriteBlockedError';
  }
}

/** The Qomon PATCH itself failed (network, auth, validation, rate limit —
 *  see qomon-client/errors.ts for the taxonomy). */
export class QomonWriteRejectedError extends Error {
  readonly statusCode = 502;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'QomonWriteRejectedError';
  }
}

/** The PATCH call itself succeeded, but what Qomon echoed back does not
 *  match what was sent. Refuses to cache an unconfirmed write. */
export class QomonWriteUnconfirmedError extends Error {
  readonly statusCode = 502;
  constructor(message: string) {
    super(message);
    this.name = 'QomonWriteUnconfirmedError';
  }
}

export interface MetadataWriteThroughDeps {
  prisma: PrismaClient;
  qomon: Pick<QomonApi, 'writeTransactionMetadata'>;
}

export interface MetadataEditInput {
  contributionId: string;
  actorUserId: string;
  /** mandatory (invariant 5); a blank reason fails before any write. */
  reason: string;
  /** the WHOLE descriptive object (D4: no partial merges). */
  descriptive: GpoMetadataDescriptive;
}

export async function writeContributionMetadata(
  deps: MetadataWriteThroughDeps,
  input: MetadataEditInput,
): Promise<ContributionMetadata> {
  const { prisma, qomon } = deps;

  const contribution = await prisma.contribution.findUnique({
    where: { id: input.contributionId },
    include: { metadata: true },
  });
  if (!contribution) throw new ContributionNotFoundError(input.contributionId);

  if (await isReceiptedOrReported(prisma, contribution.id)) {
    throw new MetadataWriteBlockedError(
      'this contribution backs an issued receipt or an RTD filing; edit it through a correction action instead (Phase 3)',
    );
  }

  const envelope = buildMetadataEnvelope({ descriptive: input.descriptive });
  const bundleId =
    contribution.qomonBundleId != null ? Number(contribution.qomonBundleId) : null;
  if (bundleId === null) {
    throw new MetadataWriteBlockedError(
      'contribution has no Qomon bundle id on record; cannot write through',
    );
  }

  let patchedBundle;
  try {
    patchedBundle = await qomon.writeTransactionMetadata(
      bundleId,
      Number(contribution.qomonTransactionId),
      envelope,
    );
  } catch (cause) {
    throw new QomonWriteRejectedError('Qomon rejected the metadata write', { cause });
  }

  const echoed = patchedBundle.transactions.find(
    (t) => t.id === Number(contribution.qomonTransactionId),
  )?.metadata;
  const confirmed =
    echoed != null &&
    echoed.v === 1 &&
    !descriptiveChanged(envelope.gpo.checksum, echoed.gpo);
  if (!confirmed) {
    throw new QomonWriteUnconfirmedError(
      'Qomon accepted the write but its echo did not match what was sent; not caching an unconfirmed edit',
    );
  }

  return withChangeLog(
    prisma,
    { userId: input.actorUserId, reason: input.reason },
    async (ctx) => {
      const before = contribution.metadata;
      const row = descriptiveToRow(input.descriptive, computeMetadataChecksum(input.descriptive));
      const after = await ctx.tx.contributionMetadata.upsert({
        where: { contributionId: contribution.id },
        create: { contributionId: contribution.id, ...row },
        update: row,
      });
      await ctx.log({
        subjectType: 'ContributionMetadata',
        subjectId: contribution.id,
        before,
        after,
      });
      return after;
    },
  );
}
