import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { storeArtifact, type ArtifactStoreDeps } from '../artifacts/store.js';
import { assertIssuanceEnabled } from '../auth/kill-switch.js';
import { withChangeLog } from '../changelog/write.js';
import type { PrintBatch, PrismaClient } from '../generated/prisma/index.js';
import type { SpaceKey } from '../space/space-state.js';
import { addCoverLetterPage } from './letters.js';
import { BATCH_TX_TIMEOUT_MS, undeliveredSpaceReceiptsWhere } from './outbox.js';
import { advanceSpaceIfDelivered } from './space-delivery.js';

/**
 * The manual print-and-mail path (ticket 3.6; the mailhouse booking, 3.7, can
 * come later). Two steps:
 *
 *  1. `createPrintBatch` takes every MAIL receipt in the space that is still
 *     undelivered and not already in an unmailed batch, and renders one PDF:
 *     for each receipt, a cover letter addressed for a window envelope, then
 *     the receipt itself. In receipt-number order.
 *  2. `markPrintBatchMailed`, once someone has printed, stuffed, and posted
 *     it, sets `Receipt.deliveredAt` to the mailing date for every receipt in
 *     the batch and closes any DELIVERY work item for them (the bounced
 *     emails that fell back to mail).
 *
 * A batch that is never marked mailed keeps its receipts out of later
 * batches, so a reprint of the same run is a re-download, not a new batch.
 */

export class NothingToPrintError extends Error {
  readonly statusCode = 409;
  constructor() {
    super('no mail receipts in this space are waiting to be printed');
    this.name = 'NothingToPrintError';
  }
}

export class PrintBatchNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(id: string) {
    super(`print batch ${id} not found`);
    this.name = 'PrintBatchNotFoundError';
  }
}

export class PrintBatchAlreadyMailedError extends Error {
  readonly statusCode = 409;
  constructor(id: string) {
    super(`print batch ${id} is already marked mailed`);
    this.name = 'PrintBatchAlreadyMailedError';
  }
}

export class PrintBatchConflictError extends Error {
  readonly statusCode = 409;
  constructor() {
    super('another print batch for this space took some of these receipts; refresh and try again');
    this.name = 'PrintBatchConflictError';
  }
}

export class MailedDateInFutureError extends Error {
  readonly statusCode = 400;
  constructor() {
    super('the mailing date cannot be in the future');
    this.name = 'MailedDateInFutureError';
  }
}

export interface CreatePrintBatchInput extends SpaceKey {
  actorUserId: string;
  reason: string;
  coverLetterBody: string;
}

export interface CreatePrintBatchResult {
  printBatch: PrintBatch;
  receiptCount: number;
}

export async function createPrintBatch(
  deps: ArtifactStoreDeps,
  input: CreatePrintBatchInput,
): Promise<CreatePrintBatchResult> {
  const { prisma } = deps;
  await assertIssuanceEnabled(prisma);

  const receipts = await prisma.receipt.findMany({
    where: {
      ...undeliveredSpaceReceiptsWhere(input),
      delivery: 'MAIL',
      pdfArtifactId: { not: null },
      printBatchItems: { none: { printBatch: { mailedAt: null } } },
    },
    include: { pdfArtifact: true, addressSnapshot: true },
    orderBy: { receiptNumber: 'asc' },
  });
  if (receipts.length === 0) throw new NothingToPrintError();

  const merged = await PDFDocument.create();
  for (const receipt of receipts) {
    await addCoverLetterPage(merged, {
      contactName: receipt.contactNameSnapshot,
      receiptNumber: receipt.receiptNumber,
      body: input.coverLetterBody,
      address: receipt.addressSnapshot,
    });
    const source = await PDFDocument.load(await readFile(path.join(deps.storageDir, receipt.pdfArtifact!.uri)));
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  const artifact = await storeArtifact(deps, {
    kind: 'PDF',
    bytes: Buffer.from(await merged.save()),
    extension: 'pdf',
  });

  const printBatch = await withChangeLog(
    prisma,
    { userId: input.actorUserId, reason: input.reason },
    async (ctx) => {
      // one batch at a time per space, then re-check nothing was taken while
      // the PDF rendered
      await ctx.tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`print-batch:${input.periodId}:${input.ridingNumber ?? 'party'}:${input.entityKind}`}))::text`;
      const taken = await ctx.tx.printBatchItem.count({
        where: { receiptId: { in: receipts.map((r) => r.id) }, printBatch: { mailedAt: null } },
      });
      if (taken > 0) throw new PrintBatchConflictError();

      const batch = await ctx.tx.printBatch.create({
        data: {
          periodId: input.periodId,
          ridingNumber: input.ridingNumber,
          entityKind: input.entityKind,
          artifactId: artifact.id,
          createdByUserId: input.actorUserId,
        },
      });
      await ctx.tx.printBatchItem.createMany({
        data: receipts.map((r, position) => ({ printBatchId: batch.id, receiptId: r.id, position })),
      });
      for (const receipt of receipts) {
        await ctx.log({
          subjectType: 'Receipt',
          subjectId: receipt.id,
          after: { deliveryChannel: 'MAIL', printBatchId: batch.id, printArtifactId: artifact.id },
        });
      }
      return batch;
    },
    { timeoutMs: BATCH_TX_TIMEOUT_MS },
  );

  return { printBatch, receiptCount: receipts.length };
}

export interface MarkPrintBatchMailedInput {
  printBatchId: string;
  actorUserId: string;
  reason: string;
  /** the day it went in the post; defaults to now */
  mailedAt?: Date;
}

export interface MarkPrintBatchMailedResult {
  printBatch: PrintBatch;
  deliveredCount: number;
  /** receipts cancelled or voided after the batch was printed: not marked
   *  delivered (the printed copy should not be posted) */
  skipped: { receiptId: string; receiptNumber: string; status: string }[];
  closedWorkItemIds: string[];
}

export async function markPrintBatchMailed(
  prisma: PrismaClient,
  input: MarkPrintBatchMailedInput,
): Promise<MarkPrintBatchMailedResult> {
  const mailedAt = input.mailedAt ?? new Date();
  if (mailedAt.getTime() > Date.now()) throw new MailedDateInFutureError();

  const batch = await prisma.printBatch.findUnique({
    where: { id: input.printBatchId },
    include: { items: { include: { receipt: true }, orderBy: { position: 'asc' } } },
  });
  if (!batch) throw new PrintBatchNotFoundError(input.printBatchId);
  if (batch.mailedAt) throw new PrintBatchAlreadyMailedError(batch.id);

  const result = await withChangeLog(
    prisma,
    { userId: input.actorUserId, reason: input.reason },
    async (ctx) => {
      const claimed = await ctx.tx.printBatch.updateMany({
        where: { id: batch.id, mailedAt: null },
        data: { mailedAt, mailedByUserId: input.actorUserId },
      });
      if (claimed.count === 0) throw new PrintBatchAlreadyMailedError(batch.id);

      const skipped: MarkPrintBatchMailedResult['skipped'] = [];
      const delivered: string[] = [];
      for (const { receipt } of batch.items) {
        if (receipt.status !== 'ISSUED') {
          skipped.push({ receiptId: receipt.id, receiptNumber: receipt.receiptNumber, status: receipt.status });
          continue;
        }
        if (receipt.deliveredAt) continue;
        await ctx.tx.receipt.update({ where: { id: receipt.id }, data: { deliveredAt: mailedAt } });
        await ctx.log({
          subjectType: 'Receipt',
          subjectId: receipt.id,
          before: { deliveredAt: null },
          after: { deliveredAt: mailedAt, deliveryChannel: 'MAIL', printBatchId: batch.id },
        });
        delivered.push(receipt.id);
      }

      const openItems = await ctx.tx.workItem.findMany({
        where: { kind: 'DELIVERY', status: 'OPEN', subjectType: 'Receipt', subjectId: { in: delivered } },
      });
      for (const item of openItems) {
        const after = await ctx.tx.workItem.update({
          where: { id: item.id },
          data: { status: 'RESOLVED', resolutionNote: `mailed in print batch ${batch.id}`, closedAt: new Date() },
        });
        await ctx.log({ subjectType: 'WorkItem', subjectId: item.id, before: item, after });
      }

      if (delivered.length === 0 && openItems.length === 0) {
        // every receipt was cancelled after printing; still record the mailing
        await ctx.log({
          subjectType: 'Receipt',
          subjectId: batch.items[0]!.receiptId,
          after: { printBatchId: batch.id, mailedAt, note: 'batch marked mailed; no receipt delivered' },
        });
      }

      return { deliveredCount: delivered.length, skipped, closedWorkItemIds: openItems.map((i) => i.id) };
    },
    { timeoutMs: BATCH_TX_TIMEOUT_MS },
  );

  await advanceSpaceIfDelivered(prisma, {
    periodId: batch.periodId,
    ridingNumber: batch.ridingNumber,
    entityKind: batch.entityKind,
  });

  const printBatch = await prisma.printBatch.findUniqueOrThrow({ where: { id: batch.id } });
  return { printBatch, ...result };
}
