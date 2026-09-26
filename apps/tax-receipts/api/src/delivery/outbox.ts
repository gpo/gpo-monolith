import { assertIssuanceEnabled } from '../auth/kill-switch.js';
import { withChangeLog } from '../changelog/write.js';
import type { EmailStatus, Prisma, PrismaClient } from '../generated/prisma/index.js';
import type { SpaceKey } from '../space/space-state.js';
import { renderCoverLetterEmail } from './letters.js';

/**
 * The email outbox (ticket 3.6). Queueing and sending are separate steps: a
 * request writes `EmailMessage` rows (QUEUED) and returns at once, and the
 * dispatcher (`dispatcher.ts`) sends them at the provider's pace. A space can
 * hold thousands of receipts, which is far more than one HTTP request can
 * send inside a timeout at Resend's rate limit.
 *
 * A receipt has at most one live email. Queueing skips any receipt that
 * already has one, so the deliver step is safe to repeat for stragglers
 * (workflows.md W4). A bounce or failure is not live: it moves the receipt to
 * MAIL (`events.ts`), so it is picked up by the next print batch instead.
 */

/** Statuses that mean "this receipt's email is handled or in flight". */
export const LIVE_EMAIL_STATUSES: EmailStatus[] = ['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'DELAYED', 'COMPLAINED'];

/** a whole space's deliver step runs in one transaction */
export const BATCH_TX_TIMEOUT_MS = 120_000;

export interface EmailAttachmentRef {
  artifactId: string;
  filename: string;
}

export interface QueueReceiptEmailsInput extends SpaceKey {
  actorUserId: string;
  reason: string;
  subject: string;
  coverLetterBody: string;
}

export interface QueueReceiptEmailsResult {
  queued: { receiptId: string; receiptNumber: string; emailMessageId: string; toAddress: string }[];
  /** EMAIL receipts whose donor has no email address on file: moved to MAIL,
   *  so the next print batch picks them up */
  movedToMail: { receiptId: string; receiptNumber: string; contactName: string }[];
}

/** ISSUED receipts in the space that are still to be delivered. */
export function undeliveredSpaceReceiptsWhere(space: SpaceKey): Prisma.ReceiptWhereInput {
  return {
    status: 'ISSUED',
    periodId: space.periodId,
    ridingNumber: space.ridingNumber,
    entityKind: space.entityKind,
    deliveredAt: null,
    // a foreign receipt (ticket 3.8) is a physical slip the donor already has
    numberSource: 'SEQUENCE',
  };
}

export async function queueSpaceReceiptEmails(
  prisma: PrismaClient,
  input: QueueReceiptEmailsInput,
): Promise<QueueReceiptEmailsResult> {
  await assertIssuanceEnabled(prisma);

  const receipts = await prisma.receipt.findMany({
    where: {
      ...undeliveredSpaceReceiptsWhere(input),
      delivery: 'EMAIL',
      pdfArtifactId: { not: null },
      emailMessages: { none: { status: { in: LIVE_EMAIL_STATUSES } } },
    },
    include: { contact: true },
    orderBy: { receiptNumber: 'asc' },
  });

  const result: QueueReceiptEmailsResult = { queued: [], movedToMail: [] };
  if (receipts.length === 0) return result;

  await withChangeLog(prisma, { userId: input.actorUserId, reason: input.reason }, async (ctx) => {
    for (const receipt of receipts) {
      const toAddress = receipt.contact.email?.trim();
      if (!toAddress) {
        const after = await ctx.tx.receipt.update({ where: { id: receipt.id }, data: { delivery: 'MAIL' } });
        await ctx.log({
          subjectType: 'Receipt',
          subjectId: receipt.id,
          before: { delivery: receipt.delivery },
          after: { delivery: after.delivery },
          reason: `${input.reason} (no email address on file; moved to mail)`,
        });
        result.movedToMail.push({
          receiptId: receipt.id,
          receiptNumber: receipt.receiptNumber,
          contactName: receipt.contactNameSnapshot,
        });
        continue;
      }

      const { text, html } = renderCoverLetterEmail({
        contactName: receipt.contactNameSnapshot,
        receiptNumber: receipt.receiptNumber,
        body: input.coverLetterBody,
      });
      const attachments: EmailAttachmentRef[] = [
        { artifactId: receipt.pdfArtifactId!, filename: `${receipt.receiptNumber}.pdf` },
      ];
      const message = await ctx.tx.emailMessage.create({
        data: {
          purpose: 'RECEIPT',
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
        after: { deliveryChannel: 'EMAIL', emailMessageId: message.id, toAddress },
      });
      result.queued.push({
        receiptId: receipt.id,
        receiptNumber: receipt.receiptNumber,
        emailMessageId: message.id,
        toAddress,
      });
    }
  }, { timeoutMs: BATCH_TX_TIMEOUT_MS });

  return result;
}
