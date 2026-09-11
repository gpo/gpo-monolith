import type { PrismaClient } from '../generated/prisma/index.js';

/**
 * Contribution detail (ticket 1.5, screens.md 3): one transaction's Qomon
 * facts, editable metadata, allocations/receipts, RTD inclusions,
 * WorkItems, and its slice of the change-log. Sync state (`lastSyncedAt`,
 * `deletedInQomonAt`) is what "cache age, last Qomon fetch" renders from.
 */

export interface ContributionDetail {
  id: string;
  qomonTransactionId: string;
  qomonBundleId: string | null;
  contact: { id: string; name: string; email: string | null };
  amountCents: number;
  currency: string;
  acceptedAt: string;
  paymentMethodKind: string | null;
  statusKind: string;
  codeCampaign: string | null;
  comment: string | null;
  externalRef: string | null;
  firstSeenAt: string;
  lastSyncedAt: string | null;
  deletedInQomonAt: string | null;
  metadata: {
    periodId: number;
    ridingNumber: number | null;
    entityKind: string;
    receivedBy: string;
    goodsServices: boolean;
    nonDeductibleCents: number;
    processedDate: string | null;
    sourceCode: string;
    eoContributorId: string | null;
    exceptionReason: string | null;
    checksum: string | null;
    syncedAt: string | null;
  } | null;
  allocations: Array<{
    id: string;
    amountCents: number;
    receipt: { id: string; receiptNumber: string; status: string; issueDate: string };
  }>;
  rtdInclusions: Array<{
    id: string;
    rtdFilingId: string;
    amountCents: number;
    aggregateAfterCents: number;
  }>;
  workItems: Array<{
    id: string;
    kind: string;
    ruleRef: string | null;
    status: string;
    openedAt: string;
    closedAt: string | null;
    resolutionNote: string | null;
  }>;
  changeLog: Array<{
    id: string;
    subjectType: string;
    actorUserId: string | null;
    reason: string;
    before: unknown;
    after: unknown;
    at: string;
    correlationId: string;
  }>;
}

export async function getContributionDetail(
  prisma: PrismaClient,
  contributionId: string,
  /** per-riding access grant; `null` = unrestricted. A row outside scope
   *  (and not party-level) is treated as not found, same as a 404. */
  ridingScope: readonly number[] | null,
): Promise<ContributionDetail | null> {
  const row = await prisma.contribution.findUnique({
    where: { id: contributionId },
    include: {
      contact: true,
      metadata: true,
      allocations: { include: { receipt: true } },
      rtdInclusions: true,
    },
  });
  if (!row) return null;
  if (
    ridingScope !== null &&
    row.metadata?.ridingNumber != null &&
    !ridingScope.includes(row.metadata.ridingNumber)
  ) {
    return null;
  }

  const [workItems, changeLog] = await Promise.all([
    prisma.workItem.findMany({
      where: { subjectType: 'Contribution', subjectId: contributionId },
      orderBy: { openedAt: 'desc' },
    }),
    prisma.changeLogEntry.findMany({
      where: {
        subjectId: contributionId,
        subjectType: { in: ['Contribution', 'ContributionMetadata'] },
      },
      orderBy: { at: 'desc' },
    }),
  ]);

  return {
    id: row.id,
    qomonTransactionId: row.qomonTransactionId.toString(),
    qomonBundleId: row.qomonBundleId != null ? row.qomonBundleId.toString() : null,
    contact: { id: row.contact.id, name: row.contact.name, email: row.contact.email },
    amountCents: row.amountCents,
    currency: row.currency,
    acceptedAt: row.acceptedAt.toISOString(),
    paymentMethodKind: row.paymentMethodKind,
    statusKind: row.statusKind,
    codeCampaign: row.codeCampaign,
    comment: row.comment,
    externalRef: row.externalRef,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
    deletedInQomonAt: row.deletedInQomonAt ? row.deletedInQomonAt.toISOString() : null,
    metadata: row.metadata
      ? {
          periodId: row.metadata.periodId,
          ridingNumber: row.metadata.ridingNumber,
          entityKind: row.metadata.entityKind,
          receivedBy: row.metadata.receivedBy,
          goodsServices: row.metadata.goodsServices,
          nonDeductibleCents: row.metadata.nonDeductibleCents,
          processedDate: row.metadata.processedDate ? row.metadata.processedDate.toISOString() : null,
          sourceCode: row.metadata.sourceCode,
          eoContributorId: row.metadata.eoContributorId,
          exceptionReason: row.metadata.exceptionReason,
          checksum: row.metadata.checksum,
          syncedAt: row.metadata.syncedAt ? row.metadata.syncedAt.toISOString() : null,
        }
      : null,
    allocations: row.allocations.map((a) => ({
      id: a.id,
      amountCents: a.amountCents,
      receipt: {
        id: a.receipt.id,
        receiptNumber: a.receipt.receiptNumber,
        status: a.receipt.status,
        issueDate: a.receipt.issueDate.toISOString(),
      },
    })),
    rtdInclusions: row.rtdInclusions.map((i) => ({
      id: i.id,
      rtdFilingId: i.rtdFilingId,
      amountCents: i.amountCents,
      aggregateAfterCents: i.aggregateAfterCents,
    })),
    workItems: workItems.map((w) => ({
      id: w.id,
      kind: w.kind,
      ruleRef: w.ruleRef,
      status: w.status,
      openedAt: w.openedAt.toISOString(),
      closedAt: w.closedAt ? w.closedAt.toISOString() : null,
      resolutionNote: w.resolutionNote,
    })),
    changeLog: changeLog.map((c) => ({
      id: c.id,
      subjectType: c.subjectType,
      actorUserId: c.actorUserId,
      reason: c.reason,
      before: c.before,
      after: c.after,
      at: c.at.toISOString(),
      correlationId: c.correlationId,
    })),
  };
}
