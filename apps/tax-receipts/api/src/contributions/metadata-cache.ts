import type { GpoMetadataDescriptive } from '@gpo/tax-receipts-core';
import type { PrismaClient } from '../generated/prisma/index.js';

/**
 * Shared between the Qomon import sweep (1.1), the manual-entry service, and
 * the metadata edit service (1.2): each writes a {@link GpoMetadataDescriptive}
 * object into the local `ContributionMetadata` row, and the edit paths must
 * refuse to touch a contribution once it backs an ISSUED receipt or an RTD
 * filing (data-model invariant 6 — that's the correction workflow's job, not
 * a plain edit's).
 */

export async function isReceiptedOrReported(
  prisma: PrismaClient,
  contributionId: string,
): Promise<boolean> {
  const [allocation, inclusion] = await Promise.all([
    prisma.receiptAllocation.findFirst({
      where: { contributionId, receipt: { status: 'ISSUED' } },
      select: { id: true },
    }),
    prisma.rtdInclusion.findFirst({ where: { contributionId }, select: { id: true } }),
  ]);
  return allocation !== null || inclusion !== null;
}

/** `checksum: null` marks a locally-derived value never confirmed against
 *  Qomon (the ticket-1.1 intake-default stub); a non-null checksum means the
 *  row reflects exactly what Qomon has (either echoed on read, or just
 *  confirmed on write). */
export function descriptiveToRow(d: GpoMetadataDescriptive, checksum: string | null) {
  return {
    periodId: d.period_id,
    ridingNumber: d.riding_number,
    entityKind: d.entity_kind,
    receivedBy: d.received_by,
    goodsServices: d.goods_services,
    nonDeductibleCents: d.non_deductible_cents,
    processedDate: d.processed_date ? new Date(d.processed_date) : null,
    sourceCode: d.source_code,
    eoContributorId: d.eo_contributor_id,
    exceptionReason: d.exception_reason,
    checksum,
    syncedAt: checksum ? new Date() : null,
  };
}
