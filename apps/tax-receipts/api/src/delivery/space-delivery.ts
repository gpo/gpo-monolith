import { stageIndex, type SpaceStage } from '@gpo/tax-receipts-core';
import type { PrismaClient } from '../generated/prisma/index.js';
import { getOrCreateSpaceState, moveSpaceStage, type SpaceKey } from '../space/space-state.js';
import { LIVE_EMAIL_STATUSES, undeliveredSpaceReceiptsWhere } from './outbox.js';

/**
 * A space's delivery picture for the issuance wizard's Deliver step (tickets
 * 3.6, 3.12), and the W6 ladder moves that go with it: a space reaches
 * `issued` when the wizard generates receipts and `delivered` once every
 * ISSUED receipt in it has gone out.
 */

/** Moves a space forward to `to`, and never backward: a space that has
 *  already moved past it (a straggler issuance in a reported space) stays
 *  where it is. */
export async function advanceSpaceStage(prisma: PrismaClient, space: SpaceKey, to: SpaceStage): Promise<void> {
  const current = await getOrCreateSpaceState(prisma, space);
  if (stageIndex(current.stage) >= stageIndex(to)) return;
  await moveSpaceStage(prisma, { ...space, to });
}

export async function advanceSpaceIfDelivered(prisma: PrismaClient, space: SpaceKey): Promise<void> {
  const [issued, undelivered] = await Promise.all([
    prisma.receipt.count({
      where: { status: 'ISSUED', periodId: space.periodId, ridingNumber: space.ridingNumber, entityKind: space.entityKind },
    }),
    prisma.receipt.count({ where: undeliveredSpaceReceiptsWhere(space) }),
  ]);
  if (issued > 0 && undelivered === 0) await advanceSpaceStage(prisma, space, 'delivered');
}

export interface DeliveryProblem {
  receiptId: string;
  receiptNumber: string;
  contactName: string;
  workItemId: string;
  detail: string | null;
}

export interface PrintBatchSummary {
  id: string;
  receiptCount: number;
  createdAt: Date;
  mailedAt: Date | null;
}

export interface SpaceDeliverySummary {
  /** ISSUED, tool-numbered receipts in the space */
  issuedCount: number;
  deliveredCount: number;
  email: {
    /** EMAIL receipts with no live email yet: what "Send emails" would queue */
    readyToQueue: number;
    queued: number;
    sent: number;
    delivered: number;
  };
  mail: {
    /** MAIL receipts not in any unmailed batch: what "Create print batch" would take */
    readyToPrint: number;
    /** in a batch that has not been marked mailed */
    printed: number;
    mailed: number;
  };
  printBatches: PrintBatchSummary[];
  /** open DELIVERY work items: emails that bounced or failed */
  problems: DeliveryProblem[];
  stage: SpaceStage;
}

export async function getSpaceDeliverySummary(prisma: PrismaClient, space: SpaceKey): Promise<SpaceDeliverySummary> {
  const receipts = await prisma.receipt.findMany({
    where: {
      status: 'ISSUED',
      numberSource: 'SEQUENCE',
      periodId: space.periodId,
      ridingNumber: space.ridingNumber,
      entityKind: space.entityKind,
    },
    select: {
      id: true,
      receiptNumber: true,
      contactNameSnapshot: true,
      delivery: true,
      deliveredAt: true,
      emailMessages: { select: { status: true, statusDetail: true }, orderBy: { queuedAt: 'desc' } },
      printBatchItems: { select: { printBatch: { select: { mailedAt: true } } } },
    },
  });

  const summary: SpaceDeliverySummary = {
    issuedCount: receipts.length,
    deliveredCount: 0,
    email: { readyToQueue: 0, queued: 0, sent: 0, delivered: 0 },
    mail: { readyToPrint: 0, printed: 0, mailed: 0 },
    printBatches: [],
    problems: [],
    stage: (await getOrCreateSpaceState(prisma, space)).stage,
  };

  for (const r of receipts) {
    if (r.deliveredAt) summary.deliveredCount += 1;
    if (r.delivery === 'EMAIL') {
      const latest = r.emailMessages.find((m) => LIVE_EMAIL_STATUSES.includes(m.status));
      if (!latest) summary.email.readyToQueue += 1;
      else if (latest.status === 'QUEUED' || latest.status === 'SENDING') summary.email.queued += 1;
      else if (latest.status === 'DELIVERED' || latest.status === 'COMPLAINED') summary.email.delivered += 1;
      else summary.email.sent += 1;
    } else if (r.deliveredAt) {
      summary.mail.mailed += 1;
    } else if (r.printBatchItems.some((i) => i.printBatch.mailedAt === null)) {
      summary.mail.printed += 1;
    } else {
      summary.mail.readyToPrint += 1;
    }
  }

  const batches = await prisma.printBatch.findMany({
    where: { periodId: space.periodId, ridingNumber: space.ridingNumber, entityKind: space.entityKind },
    include: { _count: { select: { items: true } } },
    orderBy: { createdAt: 'desc' },
  });
  summary.printBatches = batches.map((b) => ({
    id: b.id,
    receiptCount: b._count.items,
    createdAt: b.createdAt,
    mailedAt: b.mailedAt,
  }));

  const byId = new Map(receipts.map((r) => [r.id, r]));
  const items = await prisma.workItem.findMany({
    where: { kind: 'DELIVERY', status: 'OPEN', subjectType: 'Receipt', subjectId: { in: [...byId.keys()] } },
    orderBy: { openedAt: 'asc' },
  });
  summary.problems = items.map((w) => {
    const r = byId.get(w.subjectId)!;
    const undeliverable = r.emailMessages.find((m) => m.status === 'BOUNCED' || m.status === 'FAILED');
    return {
      receiptId: r.id,
      receiptNumber: r.receiptNumber,
      contactName: r.contactNameSnapshot,
      workItemId: w.id,
      detail: undeliverable?.statusDetail ?? null,
    };
  });

  return summary;
}
