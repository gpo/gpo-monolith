import { formatAddress, type FormattedAddress } from '../contacts/address.js';
import type { PrismaClient } from '../generated/prisma/index.js';

/**
 * Contribution detail (ticket 1.5, screens.md 3): one contribution, the
 * payment behind it, editable metadata, allocations/receipts, RTD
 * inclusions, WorkItems, and its slice of the change-log. `qomon` is import
 * provenance for payments that came from a Qomon transaction (null for
 * manual entries); its sync state is what "last seen in Qomon" renders from.
 */

export interface ContributionDetail {
  id: string;
  status: string;
  supersedesId: string | null;
  contact: { id: string; name: string; email: string | null; address: FormattedAddress | null };
  amountCents: number;
  acceptedAt: string;
  note: string | null;
  /** the money event behind this contribution (D12) */
  payment: {
    id: string;
    source: string;
    method: string;
    state: string;
    amountCents: number;
    currency: string;
    receivedAt: string;
    externalRef: string | null;
    payerName: string | null;
    note: string | null;
    /** what no ACTIVE contribution on this payment covers yet */
    unattributedCents: number;
  };
  /** import provenance; null for MANUAL and LEGACY_IMPORT payments */
  qomon: {
    transactionId: string;
    bundleId: string | null;
    paymentMethodKind: string | null;
    codeCampaign: string | null;
    firstSeenAt: string;
    lastSyncedAt: string | null;
    deletedInQomonAt: string | null;
  } | null;
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
      payment: { include: { qomonLink: true } },
      allocations: { include: { receipt: true } },
      rtdInclusions: true,
    },
  });
  if (!row) return null;
  if (ridingScope !== null && row.ridingNumber != null && !ridingScope.includes(row.ridingNumber)) {
    return null;
  }

  const attributed = await prisma.contribution.aggregate({
    where: { paymentId: row.paymentId, status: 'ACTIVE' },
    _sum: { amountCents: true },
  });

  const [workItems, changeLog] = await Promise.all([
    prisma.workItem.findMany({
      where: { subjectType: 'Contribution', subjectId: contributionId },
      orderBy: { openedAt: 'desc' },
    }),
    prisma.changeLogEntry.findMany({
      where: {
        OR: [
          // 'ContributionMetadata' is legacy: entries written before the fold (D12)
          { subjectId: contributionId, subjectType: { in: ['Contribution', 'ContributionMetadata'] } },
          { subjectId: row.paymentId, subjectType: 'Payment' },
        ],
      },
      orderBy: { at: 'desc' },
    }),
  ]);

  return {
    id: row.id,
    status: row.status,
    supersedesId: row.supersedesId,
    contact: {
      id: row.contact.id,
      name: row.contact.name,
      email: row.contact.email,
      address: formatAddress(row.contact.addresses),
    },
    amountCents: row.amountCents,
    acceptedAt: row.acceptedAt.toISOString(),
    note: row.note,
    payment: {
      id: row.payment.id,
      source: row.payment.source,
      method: row.payment.method,
      state: row.payment.state,
      amountCents: row.payment.amountCents,
      currency: row.payment.currency,
      receivedAt: row.payment.receivedAt.toISOString(),
      externalRef: row.payment.externalRef,
      payerName: row.payment.payerName,
      note: row.payment.note,
      unattributedCents: row.payment.amountCents - (attributed._sum.amountCents ?? 0),
    },
    qomon: row.payment.qomonLink
      ? {
          transactionId: row.payment.qomonLink.qomonTransactionId.toString(),
          bundleId:
            row.payment.qomonLink.qomonBundleId != null
              ? row.payment.qomonLink.qomonBundleId.toString()
              : null,
          paymentMethodKind: row.payment.qomonLink.qomonPaymentMethodKind,
          codeCampaign: row.payment.qomonLink.codeCampaign,
          firstSeenAt: row.payment.qomonLink.firstSeenAt.toISOString(),
          lastSyncedAt: row.payment.qomonLink.lastSyncedAt
            ? row.payment.qomonLink.lastSyncedAt.toISOString()
            : null,
          deletedInQomonAt: row.payment.qomonLink.deletedInQomonAt
            ? row.payment.qomonLink.deletedInQomonAt.toISOString()
            : null,
        }
      : null,
    // null until a period resolves: the columns' defaults are not "metadata yet"
    metadata:
      row.periodId !== null
        ? {
            periodId: row.periodId,
            ridingNumber: row.ridingNumber,
            entityKind: row.entityKind,
            receivedBy: row.receivedBy,
            goodsServices: row.goodsServices,
            nonDeductibleCents: row.nonDeductibleCents,
            processedDate: row.processedDate ? row.processedDate.toISOString() : null,
            sourceCode: row.sourceCode,
            eoContributorId: row.eoContributorId,
            exceptionReason: row.exceptionReason,
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
