import { randomUUID } from 'node:crypto';
import type { ArtifactStoreDeps } from '../artifacts/store.js';
import { withChangeLog } from '../changelog/write.js';
import type { Contribution, PrismaClient, ReceiptDelivery } from '../generated/prisma/index.js';
import { ReceiptNotFoundError, TerminalReceiptError } from '../receipts/allocate.js';
import {
  RECEIPT_CORRECTION_INCLUDE,
  CorrectionBlockedError,
  CorrectionValidationError,
  attachIssuedPdfs,
  cancelReceiptsInTx,
  issuePlannedInTx,
  labelResolver,
  openReturnNotesForNewReceipts,
  receiptCascadeEffects,
  remainingWithoutReceipt,
  renderCancellationNotices,
  type CorrectionPlan,
  type CorrectionResult,
  type IssuedInTx,
  type PlannedReceipt,
  type ReceiptForCorrection,
} from './contribution-correction.js';
import { OWED_RETURN_NOTE, openOwedToEo } from './owed-to-eo.js';

/**
 * Correction action 7: split a receipt (corrections.md). One issued receipt
 * becomes two or more, each covering a subset of the contributions it carried,
 * numbered in sequence and each printing "This cancels and replaces receipt
 * #[n]". The contributions themselves do not change (that is action 12), so
 * nothing is superseded and nothing needs a DC-1A: only the receipts, and any
 * filed return that covered them, are affected.
 *
 * Splitting a period's contributions across receipts creates extra EO
 * reporting, which is why a reason is required and the preview lists the
 * reports that go stale. A group must be one entity, riding, and period, the
 * same as any receipt.
 */

export interface SplitReceiptInput {
  receiptId: string;
  actorUserId: string;
  /** mandatory (invariant 5). */
  reason: string;
  /** the contributions each new receipt carries; together they must be
   *  exactly the contributions on the receipt, each in one group */
  groups: { contributionIds: string[] }[];
  politicalEntityLabel?: string;
  entityLabels?: Record<string, string>;
  delivery?: ReceiptDelivery;
}

async function prepareSplit(prisma: PrismaClient, input: SplitReceiptInput) {
  const found = (await prisma.receipt.findUnique({
    where: { id: input.receiptId },
    include: RECEIPT_CORRECTION_INCLUDE,
  })) as unknown as ReceiptForCorrection | null;
  if (!found) throw new ReceiptNotFoundError(input.receiptId);
  const receipt = found;
  if (receipt.status !== 'ISSUED') throw new TerminalReceiptError(receipt.id, receipt.status);
  if (input.groups.length < 2) throw new CorrectionValidationError('a split needs at least two groups');

  const onReceipt = new Map(receipt.allocations.map((a) => [a.contributionId, a.contribution]));
  const seen = new Set<string>();
  for (const group of input.groups) {
    if (group.contributionIds.length === 0) throw new CorrectionValidationError('every group needs a contribution');
    for (const id of group.contributionIds) {
      if (!onReceipt.has(id)) throw new CorrectionValidationError(`contribution ${id} is not on receipt ${receipt.receiptNumber}`);
      if (seen.has(id)) throw new CorrectionValidationError(`contribution ${id} is in more than one group`);
      seen.add(id);
    }
  }
  const missing = [...onReceipt.keys()].filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new CorrectionValidationError(
      `the groups must cover every contribution on the receipt; ${missing.length} left out (${missing.join(', ')})`,
    );
  }

  const blockers: string[] = [];
  const issue: PlannedReceipt[] = input.groups.map((group, i) => {
    const contributions = group.contributionIds.map((id) => onReceipt.get(id)!);
    const first = contributions[0]!;
    const homogeneous = contributions.every(
      (c) => c.entityKind === first.entityKind && c.ridingNumber === first.ridingNumber && c.periodId === first.periodId,
    );
    if (!homogeneous) {
      throw new CorrectionValidationError('a receipt covers one entity, riding, and period; split those into separate groups');
    }
    if (first.periodId === null) blockers.push(`contribution ${first.id} has no reporting period`);
    const lines = contributions.map((c) => ({ contributionRef: c.id, amountCents: remainingWithoutReceipt(c, receipt.id) }));
    return {
      key: `split:${i}`,
      contactId: receipt.contactId,
      contactName: receipt.contact.name,
      entityKind: first.entityKind,
      ridingNumber: first.ridingNumber,
      periodId: first.periodId ?? receipt.periodId,
      totalAmountCents: lines.reduce((sum, l) => sum + l.amountCents, 0),
      lines,
      replacesReceiptId: receipt.id,
      replacesReceiptNumber: receipt.receiptNumber,
      primaryReplacement: i === 0,
    };
  });
  if (issue.some((r) => r.lines.some((l) => l.amountCents <= 0))) {
    blockers.push('a contribution on this receipt has nothing left to receipt');
  }

  const contacts = new Map([[receipt.contactId, receipt.contact]]);
  const effects = await receiptCascadeEffects(prisma, { cancelled: [receipt], issue, contacts });
  blockers.push(...effects.blockers);

  const plan: CorrectionPlan = {
    action: 'SPLIT_RECEIPT',
    changes: [],
    payments: [],
    cancelReceipts: [
      {
        receiptId: receipt.id,
        receiptNumber: receipt.receiptNumber,
        contactName: receipt.contact.name,
        totalAmountCents: receipt.allocations.reduce((sum, a) => sum + a.amountCents, 0),
        hasPdf: receipt.pdfArtifactId != null,
      },
    ],
    issueReceipts: issue,
    owedToEo: effects.owedToEo,
    dirtyReports: effects.dirtyReports,
    labelsNeeded: effects.labelsNeeded,
    followUps: [],
    blockers: [...new Set(blockers)],
  };
  return { plan, receipt, contacts, contributions: onReceipt };
}

export async function previewReceiptSplit(prisma: PrismaClient, input: SplitReceiptInput): Promise<CorrectionPlan> {
  return (await prepareSplit(prisma, input)).plan;
}

export async function splitReceipt(deps: ArtifactStoreDeps, input: SplitReceiptInput): Promise<CorrectionResult> {
  const { prisma } = deps;
  const { plan, receipt, contacts, contributions } = await prepareSplit(prisma, input);
  if (plan.blockers.length > 0) throw new CorrectionBlockedError(plan.blockers);

  const labelFor = labelResolver(input);
  for (const r of plan.issueReceipts) labelFor(r.entityKind, r.ridingNumber);
  const noticeArtifactIds = await renderCancellationNotices(deps, [receipt]);

  const correlationId = randomUUID();
  const owedToEoWorkItemIds: string[] = [];
  const issued: IssuedInTx[] = [];

  await withChangeLog(prisma, { userId: input.actorUserId, reason: input.reason, correlationId }, async (ctx) => {
    await cancelReceiptsInTx(ctx, [receipt], noticeArtifactIds);
    for (const planned of plan.issueReceipts) {
      issued.push(
        await issuePlannedInTx(ctx, planned, {
          contacts,
          replaced: new Map([[receipt.id, receipt]]),
          delivery: input.delivery,
          resolveRef: (ref) => ref,
        }),
      );
    }
    for (const item of plan.owedToEo) {
      if (item.kind === 'RETURN_NOTE' && item.subjectId) {
        owedToEoWorkItemIds.push(
          await openOwedToEo(ctx, {
            subjectType: 'Receipt',
            subjectId: item.subjectId,
            contactId: receipt.contactId,
            ruleRef: OWED_RETURN_NOTE,
          }),
        );
      }
    }
    owedToEoWorkItemIds.push(...(await openReturnNotesForNewReceipts(ctx, issued)));
  });

  const issuedReceipts = await attachIssuedPdfs(deps, issued, {
    actorUserId: input.actorUserId,
    reason: input.reason,
    correlationId,
    labelFor,
    contributionFor: async (ref): Promise<Contribution> => contributions.get(ref)!,
  });

  return {
    correlationId,
    supersededContributionIds: [],
    refundedContributionIds: [],
    createdContributionIds: [],
    cancelledReceiptIds: [receipt.id],
    issuedReceipts,
    cancellationNoticeArtifactIds: [...noticeArtifactIds.values()],
    owedToEoWorkItemIds,
    followUps: [],
    validationFailures: [],
  };
}
