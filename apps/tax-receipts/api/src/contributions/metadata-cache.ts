import type { GpoMetadataDescriptive } from '@gpo/tax-receipts-core';
import type { PrismaClient } from '../generated/prisma/index.js';

/**
 * Shared between the Qomon import sweep (1.1), the manual-entry service, and
 * the metadata edit service (1.2): each writes a {@link GpoMetadataDescriptive}
 * object onto the local `Contribution` row, and the edit paths must
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

/** The descriptive fields as `Contribution` columns (D12: they are ordinary
 *  columns since the metadata table was folded in). Spread into a
 *  `contribution.create` or `contribution.update` `data`. */
export function descriptiveToColumns(d: GpoMetadataDescriptive) {
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
  };
}
