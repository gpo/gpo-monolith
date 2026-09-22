import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { storeArtifact, type ArtifactStoreDeps } from '../artifacts/store.js';
import { withChangeLog } from '../changelog/write.js';
import type { SpaceKey } from '../space/space-state.js';

/**
 * Delivery (ticket 3.5): the wizard's "deliver" step (screens.md screen 6,
 * story I2) — "email with the cover letter, or into one consolidated print
 * PDF per run, honouring the donor's stored preference, with every send
 * recorded as a Qomon activity on the donor."
 *
 * This ticket builds the two *formats* and the tool's own local delivery
 * record. It deliberately does not:
 *
 *  - send anything over a real email provider (ticket 3.6: "established
 *    provider on a warmed subdomain, message id + status stored") — the
 *    email path here renders the cover letter as a stored, read-only PDF
 *    artifact per donor, ready for 3.6 to actually dispatch, not a live send;
 *  - set `Receipt.deliveredAt` — that column's own home (3.6's backlog line
 *    pairs it with "provider message id and status," i.e. it means
 *    "confirmed sent," which nothing here can confirm;
 *  - log anything to Qomon. Researched and confirmed unbuildable: the Qomon
 *    API reference's gap #12 states plainly "no receipt or document
 *    facility... nothing generates, stores, or attaches documents to a
 *    transaction or contact," and there is no activity/timeline endpoint of
 *    any kind in any of the five specs (`research/qomon-api-reference.md`).
 *    The closest primitive, `Contact.notes`, is unconfirmed for safe
 *    programmatic append: Contact `PATCH` is documented as a full replace
 *    with data-loss risk (gap #14), so appending one note means read-modify-
 *    write against a record the donor or an operator could be editing
 *    concurrently in the Qomon UI. Guessing at this felt like exactly the
 *    kind of shortcut this codebase avoids elsewhere (see O28-O30, R1) —
 *    flagged as **O45** instead. The tool's own `ChangeLogEntry` is the
 *    interim source of truth for "was this sent"; a `Contact.notes` push is
 *    a real *option* once someone confirms whether it's safe, not a
 *    solved problem.
 *
 * `coverLetterBody` is a caller-supplied input, not derived here: like
 * `politicalEntityLabel` (ticket 3.1), the exact wording is the rules
 * authority's to own (workflows.md W4: "the cover letter is a template
 * editable by the rules authority") and no admin screen exists yet to store
 * or edit one — guessing at legally/organizationally-reviewed donor-facing
 * text is the wrong kind of shortcut. One value per call, same as 3.12's
 * `politicalEntityLabel`: no per-donor interpolation is attempted, since no
 * placeholder syntax is specified anywhere in the design docs.
 */

export class DeliveryReceiptNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(readonly receiptId: string) {
    super(`receipt ${receiptId} not found`);
    this.name = 'DeliveryReceiptNotFoundError';
  }
}

export class DeliveryReceiptScopeError extends Error {
  readonly statusCode = 400;
  constructor(readonly receiptId: string) {
    super(`receipt ${receiptId} does not belong to the given space`);
    this.name = 'DeliveryReceiptScopeError';
  }
}

export class DeliveryReceiptNotIssuedError extends Error {
  readonly statusCode = 409;
  constructor(readonly receiptId: string, readonly status: string) {
    super(`receipt ${receiptId} is ${status}, not ISSUED; cannot be delivered`);
    this.name = 'DeliveryReceiptNotIssuedError';
  }
}

export class DeliveryMissingPdfError extends Error {
  readonly statusCode = 409;
  constructor(readonly receiptId: string) {
    super(`receipt ${receiptId} has no rendered PDF yet`);
    this.name = 'DeliveryMissingPdfError';
  }
}

export interface DeliverSpaceReceiptsInput extends SpaceKey {
  /** the receipts to deliver — normally exactly the ids `issueReceiptsForSpace`
   *  just returned. Explicit rather than "every undelivered ISSUED receipt in
   *  the space" so calling this twice is a caller error, not a silent
   *  re-send: nothing here sets a flag that would make re-querying safe. */
  receiptIds: string[];
  actorUserId: string;
  reason: string;
  coverLetterBody: string;
}

export interface DeliverSpaceReceiptsResult {
  emailCount: number;
  mailCount: number;
  /** one cover-letter artifact per EMAIL-delivery receipt. */
  emailArtifacts: { receiptId: string; coverLetterArtifactId: string }[];
  /** one artifact covering every MAIL-delivery receipt's pages, or null when
   *  there were none. */
  consolidatedPrintArtifactId: string | null;
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** A single, plain letter-sized page: donor name, the rules-authority-owned
 *  body text, and the receipt number it accompanies. No legacy template
 *  exists for this (unlike the receipt itself, ticket 3.1) — a cover letter
 *  is new to the tool, not a paper form GPO already has on file with EO. */
async function renderCoverLetterPdf(data: {
  contactName: string;
  receiptNumber: string;
  body: string;
}): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page = pdfDoc.addPage([612, 792]); // US Letter, points

  page.drawText(data.contactName, { x: 72, y: 700, size: 12, font });
  page.drawText(`Re: Receipt ${data.receiptNumber}`, { x: 72, y: 670, size: 11, font });

  const lines = data.body.split('\n').flatMap((paragraph) => (paragraph.length === 0 ? [''] : wrapText(paragraph, 90)));
  let y = 630;
  for (const line of lines) {
    page.drawText(line, { x: 72, y, size: 10, font });
    y -= 14;
  }

  return Buffer.from(await pdfDoc.save());
}

/** Concatenates every listed receipt PDF's pages into one document, in
 *  receipt-number order, for the mailhouse to print and stuff as one run. */
async function mergeReceiptPdfs(storageDir: string, pdfUris: string[]): Promise<Buffer> {
  const merged = await PDFDocument.create();
  for (const uri of pdfUris) {
    const bytes = await readFile(path.join(storageDir, uri));
    const source = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  return Buffer.from(await merged.save());
}

export async function deliverSpaceReceipts(
  deps: ArtifactStoreDeps,
  input: DeliverSpaceReceiptsInput,
): Promise<DeliverSpaceReceiptsResult> {
  const { prisma } = deps;
  const receipts = await prisma.receipt.findMany({
    where: { id: { in: input.receiptIds } },
    include: { pdfArtifact: true },
  });

  const byId = new Map(receipts.map((r) => [r.id, r]));
  for (const receiptId of input.receiptIds) {
    const receipt = byId.get(receiptId);
    if (!receipt) throw new DeliveryReceiptNotFoundError(receiptId);
    if (
      receipt.periodId !== input.periodId ||
      receipt.ridingNumber !== input.ridingNumber ||
      receipt.entityKind !== input.entityKind
    ) {
      throw new DeliveryReceiptScopeError(receiptId);
    }
    if (receipt.status !== 'ISSUED') throw new DeliveryReceiptNotIssuedError(receiptId, receipt.status);
    if (!receipt.pdfArtifact) throw new DeliveryMissingPdfError(receiptId);
  }

  const ordered = input.receiptIds.map((id) => byId.get(id)!);
  const emailReceipts = ordered.filter((r) => r.delivery === 'EMAIL');
  const mailReceipts = ordered.filter((r) => r.delivery === 'MAIL');

  const emailArtifacts: DeliverSpaceReceiptsResult['emailArtifacts'] = [];
  for (const receipt of emailReceipts) {
    const letterBytes = await renderCoverLetterPdf({
      contactName: receipt.contactNameSnapshot,
      receiptNumber: receipt.receiptNumber,
      body: input.coverLetterBody,
    });
    const artifact = await storeArtifact(deps, { kind: 'PDF', bytes: letterBytes, extension: 'pdf' });
    await withChangeLog(prisma, { userId: input.actorUserId, reason: input.reason }, async (ctx) => {
      await ctx.log({
        subjectType: 'Receipt',
        subjectId: receipt.id,
        after: {
          deliveryChannel: 'EMAIL',
          coverLetterArtifactId: artifact.id,
          receiptPdfArtifactId: receipt.pdfArtifactId,
        },
      });
    });
    emailArtifacts.push({ receiptId: receipt.id, coverLetterArtifactId: artifact.id });
  }

  let consolidatedPrintArtifactId: string | null = null;
  if (mailReceipts.length > 0) {
    const mergedBytes = await mergeReceiptPdfs(
      deps.storageDir,
      mailReceipts.map((r) => r.pdfArtifact!.uri),
    );
    const artifact = await storeArtifact(deps, { kind: 'PDF', bytes: mergedBytes, extension: 'pdf' });
    consolidatedPrintArtifactId = artifact.id;
    for (const receipt of mailReceipts) {
      await withChangeLog(prisma, { userId: input.actorUserId, reason: input.reason }, async (ctx) => {
        await ctx.log({
          subjectType: 'Receipt',
          subjectId: receipt.id,
          after: { deliveryChannel: 'MAIL', consolidatedPrintArtifactId: artifact.id },
        });
      });
    }
  }

  return {
    emailCount: emailReceipts.length,
    mailCount: mailReceipts.length,
    emailArtifacts,
    consolidatedPrintArtifactId,
  };
}
