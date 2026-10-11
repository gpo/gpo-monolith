import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { withChangeLog } from '../changelog/write.js';
import { renderCoverLetterEmail } from '../delivery/letters.js';
import { LIVE_EMAIL_STATUSES, type EmailAttachmentRef } from '../delivery/outbox.js';
import type { Prisma, PrismaClient } from '../generated/prisma/index.js';
import { ReceiptNotFoundError } from '../receipts/errors.js';

/**
 * The donor's "cancelled copy" (corrections.md action 1: "queues the donor
 * notice with the cancelled copy, watermarked CANCELLED") — the same
 * treatment workflows.md's "Current" process already does by hand in Adobe.
 * Stamps every page of the already-rendered receipt PDF; does not touch the
 * original artifact (invariant 7 freezes `Receipt.pdfArtifactId` once set —
 * PHASE-3-NOTES ticket 3.3's own deviation 3 flagged that a correction needs
 * its own place for a new PDF, not a rewrite of the original).
 *
 * The notice is stored as an `EOForm` (kind `CANCELLATION`) and reaches the
 * donor two ways (EO evaluation row 62): downloaded from the cancelled
 * receipt (`GET /receipts/:id/cancellation-notice`) to mail, or emailed
 * through the outbox (`queueCancellationNoticeEmail` below).
 */
export async function renderCancellationNoticePdf(originalPdfBytes: Buffer): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(originalPdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const text = 'CANCELLED';
  const size = 64;
  const textWidth = font.widthOfTextAtSize(text, size);

  for (const page of pdfDoc.getPages()) {
    const { width, height } = page.getSize();
    page.drawText(text, {
      x: width / 2 - textWidth / 2,
      y: height / 2 - size / 2,
      size,
      font,
      color: rgb(0.75, 0, 0),
      opacity: 0.55,
      rotate: degrees(35),
    });
  }

  return Buffer.from(await pdfDoc.save());
}

export class CancellationNoticeError extends Error {
  constructor(
    message: string,
    readonly statusCode: 404 | 409 | 422,
  ) {
    super(message);
    this.name = 'CancellationNoticeError';
  }
}

/** The receipt's cancellation notice: the newest `CANCELLATION` EO form with
 *  a stored PDF. A receipt is cancelled once, so there is normally one. */
export async function findCancellationNotice(prisma: PrismaClient | Prisma.TransactionClient, receiptId: string) {
  return prisma.eOForm.findFirst({
    where: { receiptId, kind: 'CANCELLATION', artifactId: { not: null } },
    include: { artifact: true },
    orderBy: { createdAt: 'desc' },
  });
}

export interface QueueCancellationNoticeEmailInput {
  receiptId: string;
  actorUserId: string;
  /** mandatory (invariant 5) */
  reason: string;
  subject: string;
  /** the letter text; the rules authority owns the wording, as for the
   *  receipt cover letter (`delivery/letters.ts`) */
  body: string;
}

export interface QueueCancellationNoticeEmailResult {
  receiptId: string;
  emailMessageId: string;
  toAddress: string;
}

/**
 * Sends the donor their cancellation notice (EO evaluation row 62) through
 * the email outbox: the request writes a QUEUED `EmailMessage` and the
 * dispatcher sends it. It is a deliberate step rather than part of the
 * cancel cascade, because the operator writes the letter and a reissue
 * usually reaches the donor with its replacement anyway.
 *
 * One live notice email per receipt: a second request is refused unless the
 * first bounced or failed. A donor with no email address on file is refused
 * too; their notice is downloaded and mailed by hand.
 */
export async function queueCancellationNoticeEmail(
  prisma: PrismaClient,
  input: QueueCancellationNoticeEmailInput,
): Promise<QueueCancellationNoticeEmailResult> {
  const receipt = await prisma.receipt.findUnique({
    where: { id: input.receiptId },
    include: { contact: true },
  });
  if (!receipt) throw new ReceiptNotFoundError(input.receiptId);
  if (receipt.status !== 'CANCELLED') {
    throw new CancellationNoticeError(`receipt ${receipt.receiptNumber} is ${receipt.status}, not cancelled`, 409);
  }
  const notice = await findCancellationNotice(prisma, receipt.id);
  if (!notice) {
    throw new CancellationNoticeError(
      `receipt ${receipt.receiptNumber} has no cancellation notice (it was issued outside the tool, so there was no PDF to stamp)`,
      404,
    );
  }
  const toAddress = receipt.contact.email?.trim();
  if (!toAddress) {
    throw new CancellationNoticeError(
      `${receipt.contactNameSnapshot} has no email address on file; download the notice and mail it`,
      422,
    );
  }

  return withChangeLog(prisma, { userId: input.actorUserId, reason: input.reason }, async (ctx) => {
    const live = await ctx.tx.emailMessage.findFirst({
      where: { receiptId: receipt.id, purpose: 'CANCELLATION', status: { in: LIVE_EMAIL_STATUSES } },
    });
    if (live) {
      throw new CancellationNoticeError(
        `the cancellation notice for ${receipt.receiptNumber} is already ${live.status.toLowerCase()} to ${live.toAddress}`,
        409,
      );
    }

    const { text, html } = renderCoverLetterEmail({
      contactName: receipt.contactNameSnapshot,
      receiptNumber: receipt.receiptNumber,
      body: input.body,
    });
    const attachments: EmailAttachmentRef[] = [
      { artifactId: notice.artifactId!, filename: `${receipt.receiptNumber}-cancelled.pdf` },
    ];
    const message = await ctx.tx.emailMessage.create({
      data: {
        purpose: 'CANCELLATION',
        receiptId: receipt.id,
        contactId: receipt.contactId,
        toAddress,
        subject: input.subject,
        textBody: text,
        htmlBody: html,
        attachments: attachments as unknown as Prisma.InputJsonValue,
        queuedByUserId: input.actorUserId,
      },
    });
    await ctx.log({
      subjectType: 'Receipt',
      subjectId: receipt.id,
      after: { cancellationNoticeEmailMessageId: message.id, eoFormId: notice.id, toAddress },
    });
    return { receiptId: receipt.id, emailMessageId: message.id, toAddress };
  });
}
