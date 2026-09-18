import { QomonNotFoundError, type QomonApi } from '@gpo/qomon-client';
import {
  ingestChange,
  loadPeriods,
  refreshContactFromQomon,
  type IngestOutcome,
} from '../sync/mirror-sweep.js';
import type { PrismaClient } from '../generated/prisma/index.js';

/**
 * "Refresh from Qomon" (ticket 1.5, screens.md 3): re-fetch one
 * contribution's bundle live by id and run it through the mirror sweep's
 * own ingestion path (data-model §5: gate reads "re-fetch live by id
 * immediately before acting"). Reusing `ingestChange` keeps this identical
 * to what the sweep would do on its next pass — same diff-queue protection,
 * same metadata handling — just on demand instead of on a schedule.
 *
 * Also re-fetches the contribution's contact (ticket 3.1 follow-up): unlike
 * the bulk sweep, which fetches a contact only once (ever) to bound its
 * Qomon call volume, a one-off "refresh this contribution now" click is
 * exactly the moment a corrected address in Qomon should actually land
 * locally. A 404 on the contact fetch (deleted in Qomon) doesn't fail the
 * whole refresh — it just leaves the cached contact as-is, same tolerance
 * the sweep gives a dangling contact_id.
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

  try {
    await refreshContactFromQomon(prisma, qomon, existing.contactId);
  } catch (err) {
    if (!(err instanceof QomonNotFoundError)) throw err;
  }

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
