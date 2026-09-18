import type { GpoMetadataDescriptive } from '@gpo/tax-receipts-core';
import type { PrismaClient } from '../generated/prisma/index.js';

/**
 * Shared between the mirror sweep (1.1) and the metadata write-through
 * service (1.2): both cache a {@link GpoMetadataDescriptive} object into the
 * local `ContributionMetadata` row, and both must refuse to touch a
 * contribution's facts once it backs an ISSUED receipt or an RTD filing
 * (data-model §5 diff queue / invariant 6 — that's the Phase 3 correction
 * workflow's job, not a cache write's).
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
