import type { ArtifactStoreDeps } from '../artifacts/store.js';
import { storeArtifact } from '../artifacts/store.js';
import { withChangeLog } from '../changelog/write.js';
import type { ReceiptReprint, ReceiptReprintKind } from '../generated/prisma/index.js';
import { ReceiptNotFoundError, TerminalReceiptError } from '../receipts/allocate.js';
import { renderReceiptPdf } from '../receipts/pdf.js';

/**
 * Correction action 3 and the lost status (corrections.md, ticket 3.11): a new
 * PDF for an issued receipt WITHOUT cancelling it.
 *
 *  - LOST_COPY: the donor lost the receipt. It is reprinted unaltered and
 *    stamped COPY, and the original is flagged `lost` (EO status L; the ALL
 *    report then files it as L, open-questions O41).
 *  - CORRECTED: the donor's name was misspelled and nothing else is wrong. The
 *    receipt is regenerated with the corrected spelling. Only a non-material
 *    fix qualifies: anything that changes who the donor is, or the amount,
 *    entity, period, or date, is a reissue (actions 2 and 4 to 12), so a name
 *    that differs by more than a few characters is refused.
 *
 * The receipt row stays exactly as it was (invariant 7 freezes its PDF and its
 * name snapshot), so the reproduction lives in `ReceiptReprint`. The ALL and
 * S2P2 reports read the donor's name from the contact, not the snapshot, so the
 * corrected spelling reaches EO by fixing the contact, not by anything here.
 */

export class ReprintNotAllowedError extends Error {
  readonly statusCode = 422;
  constructor(message: string) {
    super(message);
    this.name = 'ReprintNotAllowedError';
  }
}

/** The change is not a spelling fix; it is material, so it is a reissue. */
export class MaterialChangeError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'MaterialChangeError';
  }
}

export interface ReprintInput {
  receiptId: string;
  actorUserId: string;
  /** mandatory (invariant 5). */
  reason: string;
  kind: ReceiptReprintKind;
  /** required for CORRECTED, refused for LOST_COPY */
  correctedName?: string;
  /** the EO-facing "received by" wording, caller-supplied like every issuance path */
  politicalEntityLabel: string;
}

export interface ReprintResult {
  reprintId: string;
  receiptId: string;
  artifactId: string;
  kind: ReceiptReprintKind;
  lost: boolean;
}

function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return prev[b.length]!;
}

/** True when `corrected` is the same person's name with a spelling fix: a
 *  handful of characters apart, after ignoring case, accents, and punctuation.
 *  Deliberately conservative; a refusal only sends the operator to a reissue. */
export function isSpellingFix(original: string, corrected: string): boolean {
  const a = normalizeName(original);
  const b = normalizeName(corrected);
  if (a.length === 0 || b.length === 0) return false;
  const distance = editDistance(a, b);
  return distance <= 3 && distance / Math.max(a.length, b.length) <= 0.25;
}

export async function reprintReceipt(deps: ArtifactStoreDeps, input: ReprintInput): Promise<ReprintResult> {
  const { prisma } = deps;

  const receipt = await prisma.receipt.findUnique({
    where: { id: input.receiptId },
    include: {
      addressSnapshot: true,
      allocations: { include: { contribution: true }, orderBy: { id: 'asc' } },
    },
  });
  if (!receipt) throw new ReceiptNotFoundError(input.receiptId);
  if (receipt.status !== 'ISSUED') throw new TerminalReceiptError(receipt.id, receipt.status);
  if (receipt.numberSource === 'FOREIGN') {
    throw new ReprintNotAllowedError(
      `receipt ${receipt.receiptNumber} was issued outside the tool (a foreign or EO-stock number); there is no PDF to reproduce`,
    );
  }
  if (receipt.allocations.length === 0) {
    throw new ReprintNotAllowedError(`receipt ${receipt.receiptNumber} has no allocations`);
  }

  let contributorName = receipt.contactNameSnapshot;
  if (input.kind === 'CORRECTED') {
    const corrected = input.correctedName?.trim();
    if (!corrected) throw new ReprintNotAllowedError('a corrected reprint needs the corrected name');
    if (corrected === receipt.contactNameSnapshot) {
      throw new ReprintNotAllowedError('the corrected name is the same as the name already on the receipt');
    }
    if (!isSpellingFix(receipt.contactNameSnapshot, corrected)) {
      throw new MaterialChangeError(
        `"${corrected}" is not a spelling fix of "${receipt.contactNameSnapshot}"; a change of who the donor is ` +
          'is material, so reissue the receipt (or move the contribution) instead',
      );
    }
    contributorName = corrected;
  } else if (input.correctedName !== undefined) {
    throw new ReprintNotAllowedError('a lost-receipt copy is reprinted unaltered; it takes no corrected name');
  }

  // The first allocated contribution stands in for the printed date and
  // goods-and-services flag on a multi-line receipt (O44, same as reissue).
  const primary = receipt.allocations[0]!.contribution;
  const snapshot = receipt.addressSnapshot;
  const bytes = await renderReceiptPdf({
    receiptNumber: receipt.receiptNumber,
    issueDate: receipt.issueDate,
    acceptedAt: primary.acceptedAt,
    eligibleAmountCents: receipt.allocations.reduce((sum, a) => sum + a.amountCents, 0),
    isGoodsServices: primary.goodsServices,
    politicalEntityLabel: input.politicalEntityLabel,
    eoContributorId: primary.eoContributorId,
    contributorName,
    addressLine1: snapshot.line1,
    addressLine2: snapshot.line2,
    city: snapshot.city,
    province: snapshot.province,
    postalCode: snapshot.postalCode,
    country: snapshot.country,
    isCopy: input.kind === 'LOST_COPY',
  });
  const artifact = await storeArtifact(deps, { kind: 'PDF', bytes, extension: 'pdf' });

  const reprint: ReceiptReprint = await withChangeLog(
    prisma,
    { userId: input.actorUserId, reason: input.reason },
    async (ctx) => {
      const created = await ctx.tx.receiptReprint.create({
        data: {
          receiptId: receipt.id,
          kind: input.kind,
          correctedName: input.kind === 'CORRECTED' ? contributorName : null,
          artifactId: artifact.id,
          reason: input.reason,
          createdByUserId: input.actorUserId,
        },
      });
      if (input.kind === 'LOST_COPY' && !receipt.lost) {
        await ctx.tx.receipt.update({ where: { id: receipt.id }, data: { lost: true } });
        await ctx.log({ subjectType: 'Receipt', subjectId: receipt.id, before: { lost: false }, after: { lost: true } });
      }
      await ctx.log({
        subjectType: 'Receipt',
        subjectId: receipt.id,
        after: { reprintId: created.id, kind: created.kind, artifactId: artifact.id, correctedName: created.correctedName },
      });
      return created;
    },
  );

  return {
    reprintId: reprint.id,
    receiptId: receipt.id,
    artifactId: artifact.id,
    kind: reprint.kind,
    lost: receipt.lost || input.kind === 'LOST_COPY',
  };
}
