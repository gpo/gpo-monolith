import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  formatReceiptNumber,
  isTerminalReceiptStatus,
  remainingEligibleCents,
  type AllocationRow,
} from '@gpo/tax-receipts-core';
import { storeArtifact, type ArtifactStoreDeps } from '../artifacts/store.js';
import { assertIssuanceEnabled } from '../auth/kill-switch.js';
import { withChangeLog } from '../changelog/write.js';
import { addressFrom } from '../contacts/address.js';
import type { PrismaClient, Receipt, ReceiptDelivery } from '../generated/prisma/index.js';
import { renderReceiptPdf } from '../receipts/pdf.js';
import { ReceiptNotFoundError, TerminalReceiptError } from '../receipts/allocate.js';
import { MissingAddressError, ReceiptIssuanceValidationError } from '../receipts/issue.js';
import { renderCancellationNoticePdf } from './cancellation-notice.js';

/**
 * Correction actions 1 and 2 (corrections.md, ticket 3.10): cancel, and
 * cancel-plus-reissue. Both share one cascade:
 *
 *  1. the receipt's `status` flips to `CANCELLED` (number retained,
 *     invariant 7 already treats this as a one-way, terminal transition);
 *  2. its allocations are left in place, permanently, as the audit record
 *     of what the cancelled receipt covered -- "releasing" them needs no
 *     write at all, since `remainingEligibleCents` (invariant 1) already
 *     only counts an `ISSUED` receipt's allocations, so a cancelled
 *     receipt's contributions become eligible again the instant its status
 *     changes;
 *  3. a "cancelled copy" is rendered for the donor (watermarked CANCELLED,
 *     `cancellation-notice.ts`) when the original had a PDF at all -- a
 *     foreign/EO-stock receipt (ticket 3.8) never had one, so this step is
 *     skipped for those, not faked;
 *  4. any allocated contribution that was already RTD-reported (an
 *     `RtdInclusion` in a SENT filing) gets an `OWED_TO_EO` `WorkItem` --
 *     this is the queue's first real producer; ticket 2.4's
 *     `generateDc1aAmendment` has been able to resolve one since it shipped,
 *     but nothing created one until now (2.8's own note: "nothing populates
 *     [the owed-to-EO queue] yet (ticket 3.10)").
 *
 * `reissueReceipt` runs that cascade, then issues one replacement receipt
 * covering every contribution the old one carried (re-deriving each
 * contribution's remaining eligible amount fresh, now that the cancelled
 * allocations are excluded) -- this is deliberately the first place a
 * multi-contribution receipt can be reissued as such, closing the gap
 * `receipts/allocate.ts`'s own header comment flagged forward to this
 * ticket. `politicalEntityLabel` stays a caller input, same open
 * compliance-wording question ticket 3.1 already declined to guess at.
 *
 * What corrections.md's actions 1/2 ask for that this does NOT build:
 * the exact "This cancels and replaces receipt #[n]" printed text on the
 * new PDF, and the lost-receipt "Copy" stamp -- both ticket 3.11's job
 * (Evaluation Tool rows 59-63), not guessed at here. Actions 3 through 10
 * (lightweight reprint, correct-amount chaining, donor moves, splits,
 * refunds, reallocation, contact merge) are each their own follow-up slice
 * of this ticket, not attempted in this pass -- see PHASE-3-NOTES.md.
 */

export interface CorrectionCascadeContribution {
  contributionId: string;
  amountCents: number;
  rtdReported: boolean;
}

export interface CorrectionCascadePreview {
  receiptId: string;
  receiptNumber: string;
  status: string;
  contactName: string;
  totalAmountCents: number;
  hasPdf: boolean;
  contributions: CorrectionCascadeContribution[];
  /** how many of the allocated contributions will get an OWED_TO_EO WorkItem
   *  opened -- corrections.md principle 2, "cascade preview first". */
  owedToEoCount: number;
}

type ReceiptForCorrection = Receipt & {
  contact: { id: string; name: string; qomonContactId: bigint; addresses: unknown };
  pdfArtifact: { uri: string } | null;
  allocations: {
    id: string;
    contributionId: string;
    amountCents: number;
    contribution: { rtdInclusions: { rtdFiling: { submittedAt: Date | null } }[] };
  }[];
};

async function loadReceiptForCorrection(prisma: PrismaClient, receiptId: string): Promise<ReceiptForCorrection> {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    include: {
      contact: true,
      pdfArtifact: true,
      allocations: {
        include: { contribution: { include: { rtdInclusions: { include: { rtdFiling: true } } } } },
      },
    },
  });
  if (!receipt) throw new ReceiptNotFoundError(receiptId);
  return receipt as ReceiptForCorrection;
}

function cascadeContributions(receipt: ReceiptForCorrection): CorrectionCascadeContribution[] {
  return receipt.allocations.map((a) => ({
    contributionId: a.contributionId,
    amountCents: a.amountCents,
    rtdReported: a.contribution.rtdInclusions.some((i) => i.rtdFiling.submittedAt != null),
  }));
}

export async function previewReceiptCorrection(
  prisma: PrismaClient,
  receiptId: string,
): Promise<CorrectionCascadePreview> {
  const receipt = await loadReceiptForCorrection(prisma, receiptId);
  const contributions = cascadeContributions(receipt);
  return {
    receiptId: receipt.id,
    receiptNumber: receipt.receiptNumber,
    status: receipt.status,
    contactName: receipt.contactNameSnapshot,
    totalAmountCents: contributions.reduce((sum, c) => sum + c.amountCents, 0),
    hasPdf: receipt.pdfArtifactId != null,
    contributions,
    owedToEoCount: contributions.filter((c) => c.rtdReported).length,
  };
}

interface CascadeCoreResult {
  cancellationNoticeArtifactId: string | null;
  owedToEoWorkItemIds: string[];
}

async function cancelReceiptCore(
  deps: ArtifactStoreDeps,
  receipt: ReceiptForCorrection,
  correlationId: string,
  actorUserId: string,
  reason: string,
): Promise<CascadeCoreResult> {
  if (isTerminalReceiptStatus(receipt.status)) {
    throw new TerminalReceiptError(receipt.id, receipt.status);
  }

  let cancellationNoticeArtifactId: string | null = null;
  if (receipt.pdfArtifact) {
    const originalBytes = await readFile(path.join(deps.storageDir, receipt.pdfArtifact.uri));
    const watermarked = await renderCancellationNoticePdf(originalBytes);
    const artifact = await storeArtifact(deps, { kind: 'PDF', bytes: watermarked, extension: 'pdf' });
    cancellationNoticeArtifactId = artifact.id;
  }

  const contributions = cascadeContributions(receipt);
  const owedToEoWorkItemIds: string[] = [];

  await withChangeLog(deps.prisma, { userId: actorUserId, reason, correlationId }, async (ctx) => {
    const after = await ctx.tx.receipt.update({ where: { id: receipt.id }, data: { status: 'CANCELLED' } });
    await ctx.log({
      subjectType: 'Receipt',
      subjectId: receipt.id,
      before: { status: receipt.status },
      after: { status: after.status },
    });

    if (cancellationNoticeArtifactId) {
      const eoForm = await ctx.tx.eOForm.create({
        data: { kind: 'CANCELLATION', subject: 'receipt', receiptId: receipt.id, artifactId: cancellationNoticeArtifactId },
      });
      await ctx.log({
        subjectType: 'Receipt',
        subjectId: receipt.id,
        after: { cancellationNoticeArtifactId, eoFormId: eoForm.id },
      });
    }

    for (const c of contributions) {
      if (!c.rtdReported) continue;
      const item = await ctx.tx.workItem.create({
        data: {
          kind: 'OWED_TO_EO',
          subjectType: 'Contribution',
          subjectId: c.contributionId,
          contactId: receipt.contactId,
          ruleRef: 'corrections-11',
        },
      });
      owedToEoWorkItemIds.push(item.id);
      await ctx.log({ subjectType: 'WorkItem', subjectId: item.id, after: item });
    }
  });

  return { cancellationNoticeArtifactId, owedToEoWorkItemIds };
}

export interface CancelReceiptInput {
  receiptId: string;
  actorUserId: string;
  /** mandatory (invariant 5; corrections.md requires a reason on every
   *  correction action). */
  reason: string;
}

export interface CancelReceiptResult extends CascadeCoreResult {
  receiptId: string;
}

/** Action 1, without replacement: cancels a receipt outright (e.g. an
 *  ineligible donor, a duplicate). No kill-switch check -- cancelling
 *  reduces the year's receipted count rather than adding to it, so there's
 *  no reason the statutory issuance freeze should block it. */
export async function cancelReceipt(
  deps: ArtifactStoreDeps,
  input: CancelReceiptInput,
): Promise<CancelReceiptResult> {
  const receipt = await loadReceiptForCorrection(deps.prisma, input.receiptId);
  const correlationId = randomUUID();
  const result = await cancelReceiptCore(deps, receipt, correlationId, input.actorUserId, input.reason);
  return { receiptId: receipt.id, ...result };
}

export interface ReissueReceiptDeps extends ArtifactStoreDeps {
  prisma: PrismaClient;
}

export interface ReissueReceiptInput {
  receiptId: string;
  actorUserId: string;
  reason: string;
  /** same open compliance-wording question ticket 3.1 already declined to
   *  guess at; required here for the same reason. */
  politicalEntityLabel: string;
  delivery?: ReceiptDelivery;
}

export interface ReissueReceiptResult extends CascadeCoreResult {
  cancelledReceiptId: string;
  newReceiptId: string;
  newReceiptNumber: string;
  newReceiptPdfArtifactId: string;
  newReceiptAmountCents: number;
}

const SEQUENCE_PREFIX = 'GPO-';

/** Action 2: cancel, then issue a replacement from current data covering
 *  every contribution the cancelled receipt carried -- one contribution or
 *  several (`receipts/allocate.ts`'s many-to-many, exercised here as a real
 *  reissue for the first time). Every contribution's replacement amount is
 *  re-derived fresh rather than copied from the old allocation, so a
 *  correction to the underlying contribution (a metadata edit, another
 *  receipt absorbing part of it) between the original issuance and this
 *  reissue is picked up automatically. */
export async function reissueReceipt(
  deps: ReissueReceiptDeps,
  input: ReissueReceiptInput,
): Promise<ReissueReceiptResult> {
  const { prisma } = deps;
  await assertIssuanceEnabled(prisma);

  const receipt = await loadReceiptForCorrection(prisma, input.receiptId);
  if (receipt.allocations.length === 0) {
    throw new ReceiptIssuanceValidationError(`receipt ${receipt.id} has no allocations to reissue`);
  }

  const correlationId = randomUUID();
  const cascade = await cancelReceiptCore(deps, receipt, correlationId, input.actorUserId, input.reason);

  // Re-derive fresh: the cancel above just excluded these allocations from
  // remainingEligibleCents, so a contribution's true remaining amount can
  // only be known by re-querying now.
  const contributionIds = receipt.allocations.map((a) => a.contributionId);
  const contributions = await prisma.contribution.findMany({
    where: { id: { in: contributionIds } },
    include: { metadata: true, allocations: { include: { receipt: true } } },
  });

  const rawAddress = addressFrom(receipt.contact.addresses);
  const missingAddressFields = [
    !rawAddress?.street && 'a street',
    !rawAddress?.city && 'a city',
    !rawAddress?.postalcode && 'a postal code',
  ].filter((f): f is string => f !== false);
  if (missingAddressFields.length > 0) {
    throw new MissingAddressError(receipt.contact.name, String(receipt.contact.qomonContactId), missingAddressFields);
  }
  const address = rawAddress!;
  const addressLine1 = [address.housenumber, address.street].filter(Boolean).join(' ');
  const province = address.state ?? 'ON';
  const country = address.country ?? 'CA';

  // Every line below is provably positive, not just usually: invariant 1
  // guarantees sum(other ISSUED allocations for c) + c's own
  // just-cancelled amount never exceeded c's eligible amount, so releasing
  // that one allocation always frees back at least its own amount. There is
  // no live database state this loop could observe where `remaining` comes
  // back <= 0 for a contribution that was actually allocated to the receipt
  // just cancelled -- kept as an explicit guard anyway (not a silent
  // `continue`/skip) so a future change to invariant 1 fails loudly here
  // instead of quietly reissuing for less than it should.
  const lines: { contributionId: string; amountCents: number }[] = [];
  for (const c of contributions) {
    const allocationRows: AllocationRow[] = c.allocations.map((a) => ({
      receiptId: a.receiptId,
      contributionId: a.contributionId,
      amountCents: a.amountCents,
      receiptStatus: a.receipt.status,
    }));
    const remaining = remainingEligibleCents(
      { id: c.id, amountCents: c.amountCents, nonDeductibleCents: c.metadata!.nonDeductibleCents },
      allocationRows,
    );
    if (remaining <= 0) {
      throw new ReceiptIssuanceValidationError(
        `invariant 1 violation surfaced during reissue: contribution ${c.id} has ${remaining}c remaining ` +
          `after releasing receipt ${receipt.id}'s allocation, which should be mathematically impossible`,
      );
    }
    lines.push({ contributionId: c.id, amountCents: remaining });
  }

  const created = await withChangeLog(
    prisma,
    { userId: input.actorUserId, reason: input.reason, correlationId },
    async (ctx) => {
      const snapshot = await ctx.tx.addressSnapshot.create({
        data: {
          contactId: receipt.contactId,
          periodId: receipt.periodId,
          line1: addressLine1 || 'unknown',
          city: address.city!,
          province,
          postalCode: address.postalcode!,
          country,
          source: 'reissue',
        },
      });
      await ctx.log({ subjectType: 'AddressSnapshot', subjectId: snapshot.id, after: snapshot });

      const seq = await ctx.tx.receiptSequence.update({
        where: { prefix: SEQUENCE_PREFIX },
        data: { counter: { increment: 1 } },
      });
      const receiptNumber = formatReceiptNumber(SEQUENCE_PREFIX, seq.counter);

      const newReceipt = await ctx.tx.receipt.create({
        data: {
          receiptNumber,
          numberSource: 'SEQUENCE',
          entityKind: receipt.entityKind,
          ridingNumber: receipt.ridingNumber,
          periodId: receipt.periodId,
          issueDate: new Date(),
          contactId: receipt.contactId,
          contactNameSnapshot: receipt.contactNameSnapshot,
          addressSnapshotId: snapshot.id,
          delivery: input.delivery ?? receipt.delivery,
          reissuedFromId: receipt.id,
        },
      });
      await ctx.log({
        subjectType: 'Receipt',
        subjectId: newReceipt.id,
        after: { receiptNumber, reissuedFromId: receipt.id },
      });

      let totalAmountCents = 0;
      for (const line of lines) {
        const allocation = await ctx.tx.receiptAllocation.create({
          data: { receiptId: newReceipt.id, contributionId: line.contributionId, amountCents: line.amountCents },
        });
        await ctx.log({ subjectType: 'ReceiptAllocation', subjectId: allocation.id, after: allocation });
        totalAmountCents += line.amountCents;
      }

      // One-time NULL -> value (invariant 7): safe now that the new
      // receipt's id actually exists.
      const oldAfter = await ctx.tx.receipt.update({
        where: { id: receipt.id },
        data: { replacedById: newReceipt.id },
      });
      await ctx.log({
        subjectType: 'Receipt',
        subjectId: receipt.id,
        before: { replacedById: null },
        after: { replacedById: oldAfter.replacedById },
      });

      return { newReceipt, totalAmountCents };
    },
  );

  // O44 (open-questions.md): which contribution's acceptedAt/goodsServices
  // prints on a multi-allocation receipt has no answer yet -- same call
  // ticket 3.2 already declined to make. Uses the first line's contribution
  // as a stand-in rather than inventing a rule.
  const primary = contributions.find((c) => c.id === lines[0]!.contributionId)!;
  const pdfBytes = await renderReceiptPdf({
    receiptNumber: created.newReceipt.receiptNumber,
    issueDate: created.newReceipt.issueDate,
    acceptedAt: primary.acceptedAt,
    eligibleAmountCents: created.totalAmountCents,
    isGoodsServices: primary.metadata!.goodsServices,
    politicalEntityLabel: input.politicalEntityLabel,
    eoContributorId: primary.metadata!.eoContributorId,
    contributorName: receipt.contactNameSnapshot,
    addressLine1,
    addressLine2: null,
    city: address.city!,
    province,
    postalCode: address.postalcode!,
    country,
  });
  const artifact = await storeArtifact(deps, { kind: 'PDF', bytes: pdfBytes, extension: 'pdf' });

  const withPdf = await withChangeLog(
    prisma,
    { userId: input.actorUserId, reason: input.reason, correlationId },
    async (ctx) => {
      const updated = await ctx.tx.receipt.update({
        where: { id: created.newReceipt.id },
        data: { pdfArtifactId: artifact.id },
      });
      await ctx.log({ subjectType: 'Receipt', subjectId: created.newReceipt.id, after: { pdfArtifactId: artifact.id } });
      return updated;
    },
  );

  return {
    cancelledReceiptId: receipt.id,
    cancellationNoticeArtifactId: cascade.cancellationNoticeArtifactId,
    owedToEoWorkItemIds: cascade.owedToEoWorkItemIds,
    newReceiptId: withPdf.id,
    newReceiptNumber: withPdf.receiptNumber,
    newReceiptPdfArtifactId: artifact.id,
    newReceiptAmountCents: created.totalAmountCents,
  };
}
