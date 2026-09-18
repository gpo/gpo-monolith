import type { QomonApi } from '@gpo/qomon-client';
import { ingestChange, loadPeriods, type IngestOutcome } from '../sync/mirror-sweep.js';
import type { PrismaClient } from '../generated/prisma/index.js';

/**
 * "Refresh from Qomon" (ticket 1.5, screens.md 3): re-fetch one
 * contribution's bundle live by id and run it through the mirror sweep's
 * own ingestion path (data-model §5: gate reads "re-fetch live by id
 * immediately before acting"). Reusing `ingestChange` keeps this identical
 * to what the sweep would do on its next pass — same diff-queue protection,
 * same metadata handling — just on demand instead of on a schedule.
 */

export class ContributionNotMirroredError extends Error {
  readonly statusCode = 404;
  constructor(contributionId: string) {
    super(`no contribution ${contributionId}`);
    this.name = 'ContributionNotMirroredError';
  }
}

export async function refreshContributionFromQomon(
  prisma: PrismaClient,
  qomon: Pick<QomonApi, 'getTransactionBundle' | 'getContact' | 'listTransactionStatuses'>,
  contributionId: string,
): Promise<IngestOutcome> {
  const existing = await prisma.contribution.findUnique({ where: { id: contributionId } });
  if (!existing) throw new ContributionNotMirroredError(contributionId);
  if (existing.qomonBundleId == null) {
    // never had a bundle id on record (shouldn't happen post-1.1, but the
    // schema allows it): nothing to re-fetch from.
    return 'unchanged';
  }

  const bundle = await qomon.getTransactionBundle(Number(existing.qomonBundleId));
  const transaction = bundle.transactions.find(
    (t) => BigInt(t.id) === existing.qomonTransactionId,
  );
  if (!transaction) {
    // the transaction is gone from its bundle; the next full sweep's
    // deletion detection is the authoritative path for this (invariant 4),
    // not a one-off refresh.
    return 'unchanged';
  }

  const periods = await loadPeriods(prisma);
  const statuses = await qomon.listTransactionStatuses();
  const statusKindById = new Map(statuses.map((s) => [s.id, s.kind]));

  return ingestChange(prisma, qomon, periods, statusKindById, {
    bundle,
    transaction,
    changedAt: bundle.UpdatedAt ?? bundle.CreatedAt ?? new Date().toISOString(),
  });
}
