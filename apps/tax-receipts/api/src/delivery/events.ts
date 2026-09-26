import { contributionYear } from '@gpo/tax-receipts-core';
import { withChangeLog, type ChangeLogContext } from '../changelog/write.js';
import { Prisma, type EmailMessage, type EmailStatus, type PrismaClient } from '../generated/prisma/index.js';
import type { EmailDeliveryEvent } from './email-provider.js';

/**
 * Provider events and what they do (ticket 3.6).
 *
 * The backlog line is "hard bounce -> WorkItem that flips the donor to
 * MAIL". The flip happens at once rather than waiting on someone to resolve
 * the item: a receipt nobody can email should be in the next print batch
 * without anyone having to remember it. The DELIVERY work item is the
 * follow-up record (check the address in Qomon, confirm it went by mail); it
 * closes itself when the print batch carrying the receipt is marked mailed.
 *
 * Three things count as undeliverable: a permanent bounce, a suppression (the
 * provider would not even try), and a send that failed for good. Each moves
 * the receipt to MAIL with `deliveredAt` cleared, sets the donor's
 * `DonorCyclePreference` for that year to MAIL, and opens the work item. A
 * complaint (the donor marked it as spam) is recorded but changes nothing:
 * the email did arrive.
 *
 * Events can arrive out of order and more than once. `providerEventId` is
 * unique, so a redelivery is a no-op, and a status never moves back from
 * undeliverable to delivered.
 */

const UNDELIVERABLE: EmailStatus[] = ['BOUNCED', 'FAILED'];
const TERMINAL: EmailStatus[] = ['BOUNCED', 'FAILED', 'COMPLAINED'];

export interface UndeliverableInput {
  message: Pick<EmailMessage, 'id' | 'purpose' | 'receiptId' | 'contactId' | 'toAddress'>;
  detail: string;
}

/** Runs inside the caller's change-logged transaction. Returns the opened
 *  work item's id, or null when there was nothing to move (a pre-check
 *  email, or a receipt that is no longer ISSUED). */
export async function markEmailUndeliverable(
  ctx: ChangeLogContext,
  input: UndeliverableInput,
): Promise<string | null> {
  const { message } = input;
  if (message.purpose !== 'RECEIPT' || !message.receiptId) return null;

  const receipt = await ctx.tx.receipt.findUnique({
    where: { id: message.receiptId },
    include: { period: true },
  });
  if (!receipt || receipt.status !== 'ISSUED') return null;

  const reason = `email to ${message.toAddress} undeliverable: ${input.detail}`;

  const after = await ctx.tx.receipt.update({
    where: { id: receipt.id },
    data: { delivery: 'MAIL', deliveredAt: null },
  });
  await ctx.log({
    subjectType: 'Receipt',
    subjectId: receipt.id,
    before: { delivery: receipt.delivery, deliveredAt: receipt.deliveredAt },
    after: { delivery: after.delivery, deliveredAt: after.deliveredAt, emailMessageId: message.id },
    reason,
  });

  const year = contributionYear(receipt.period.startsAt);
  const prefBefore = await ctx.tx.donorCyclePreference.findUnique({
    where: { contactId_year: { contactId: receipt.contactId, year } },
  });
  if (prefBefore?.delivery !== 'MAIL') {
    const prefAfter = await ctx.tx.donorCyclePreference.upsert({
      where: { contactId_year: { contactId: receipt.contactId, year } },
      create: { contactId: receipt.contactId, year, delivery: 'MAIL' },
      update: { delivery: 'MAIL' },
    });
    await ctx.log({
      subjectType: 'DonorCyclePreference',
      subjectId: prefAfter.id,
      before: prefBefore,
      after: prefAfter,
      reason,
    });
  }

  const existing = await ctx.tx.workItem.findFirst({
    where: { kind: 'DELIVERY', status: 'OPEN', subjectType: 'Receipt', subjectId: receipt.id },
  });
  if (existing) return existing.id;
  const item = await ctx.tx.workItem.create({
    data: {
      kind: 'DELIVERY',
      subjectType: 'Receipt',
      subjectId: receipt.id,
      contactId: receipt.contactId,
    },
  });
  await ctx.log({ subjectType: 'WorkItem', subjectId: item.id, after: item, reason });
  return item.id;
}

function nextStatus(current: EmailStatus, event: EmailDeliveryEvent['type']): EmailStatus | null {
  switch (event) {
    case 'sent':
      return null; // the dispatcher already recorded SENT
    case 'delivered':
      return TERMINAL.includes(current) ? null : 'DELIVERED';
    case 'delayed':
      return current === 'SENT' || current === 'SENDING' ? 'DELAYED' : null;
    case 'complained':
      return UNDELIVERABLE.includes(current) ? null : 'COMPLAINED';
    case 'bounced':
    case 'suppressed':
      return UNDELIVERABLE.includes(current) ? null : 'BOUNCED';
    case 'failed':
      return UNDELIVERABLE.includes(current) ? null : 'FAILED';
  }
}

export interface ApplyEmailEventsResult {
  applied: number;
  duplicates: number;
  /** events for a message id this tool never sent (another app on the same
   *  provider account, or a message from before a database restore) */
  unknown: number;
}

export async function applyEmailEvents(
  prisma: PrismaClient,
  events: EmailDeliveryEvent[],
): Promise<ApplyEmailEventsResult> {
  const result: ApplyEmailEventsResult = { applied: 0, duplicates: 0, unknown: 0 };

  for (const event of events) {
    const message = await prisma.emailMessage.findUnique({
      where: { providerMessageId: event.providerMessageId },
    });
    if (!message) {
      result.unknown += 1;
      continue;
    }

    const status = nextStatus(message.status, event.type);
    const detail = event.detail ?? event.type;

    const record = async (tx: Prisma.TransactionClient) => {
      await tx.emailEvent.create({
        data: {
          emailMessageId: message.id,
          providerEventId: event.providerEventId,
          type: event.type,
          occurredAt: event.occurredAt,
          detail: event.detail ?? null,
          payload: event.payload as Prisma.InputJsonValue,
        },
      });
      await tx.emailMessage.update({
        where: { id: message.id },
        data: {
          lastEventAt: event.occurredAt,
          ...(status ? { status, statusDetail: event.detail ?? null } : {}),
        },
      });
    };

    try {
      if (status && UNDELIVERABLE.includes(status)) {
        await withChangeLog(
          prisma,
          { userId: null, reason: `email ${event.type} (provider event ${event.providerEventId})` },
          async (ctx) => {
            await record(ctx.tx);
            const workItemId = await markEmailUndeliverable(ctx, { message, detail });
            // a pre-check bounce moves nothing, but the transaction still
            // needs its entry
            if (!workItemId) {
              await ctx.log({
                subjectType: 'Contact',
                subjectId: message.contactId,
                after: { emailMessageId: message.id, purpose: message.purpose, status, detail },
              });
            }
          },
        );
      } else {
        // email_message and email_event are not change-log guarded; the event
        // row is the record
        await prisma.$transaction(record);
      }
      result.applied += 1;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        result.duplicates += 1;
        continue;
      }
      throw err;
    }
  }

  return result;
}
