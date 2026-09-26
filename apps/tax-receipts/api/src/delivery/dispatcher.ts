import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getKillSwitch } from '../auth/kill-switch.js';
import { withChangeLog } from '../changelog/write.js';
import type { EmailMessage, PrismaClient } from '../generated/prisma/index.js';
import { EmailSendError, type EmailProvider } from './email-provider.js';
import { markEmailUndeliverable } from './events.js';
import type { EmailAttachmentRef } from './outbox.js';
import { advanceSpaceIfDelivered } from './space-delivery.js';

/**
 * Sends queued email (ticket 3.6). One pass claims up to `limit` QUEUED rows
 * with `FOR UPDATE SKIP LOCKED`, so two API replicas never send the same row,
 * then sends them one at a time at `ratePerSecond`.
 *
 * - A receipt email that the provider accepts sets `Receipt.deliveredAt`
 *   ("sent", the same meaning mail gets when a print batch is marked mailed).
 *   A later bounce clears it again (`events.ts`).
 * - A retryable failure (rate limit, 5xx, network) goes back to QUEUED with
 *   exponential backoff; the retry reuses the row id as the idempotency key,
 *   so a send the provider accepted just before a crash is not repeated.
 *   After `maxAttempts`, or on any non-retryable error, the row is FAILED and
 *   treated like a bounce.
 * - A row left in SENDING by a crashed process is reclaimed after
 *   `staleClaimMinutes`.
 * - While the issuance kill switch is engaged, receipt email waits in the
 *   queue; pre-check email still goes, since it issues nothing.
 * - `dailyLimit` caps sends in any rolling 24 hours, for warming up a new
 *   sending domain.
 */

export interface DispatchDeps {
  prisma: PrismaClient;
  storageDir: string;
  provider: EmailProvider;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface DispatchOptions {
  limit?: number;
  ratePerSecond?: number;
  dailyLimit?: number | null;
  maxAttempts?: number;
  staleClaimMinutes?: number;
}

export interface DispatchResult {
  sent: number;
  retrying: number;
  failed: number;
  /** receipt emails left queued because the kill switch is engaged */
  heldByKillSwitch: boolean;
  /** the daily cap stopped this pass short */
  dailyLimitReached: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function backoffMs(attempts: number): number {
  return Math.min(60, 2 ** (attempts - 1)) * 60_000; // 1, 2, 4 ... 60 minutes
}

async function claim(
  prisma: PrismaClient,
  opts: { limit: number; now: Date; receiptsAllowed: boolean },
): Promise<EmailMessage[]> {
  const purposes = opts.receiptsAllowed ? ['RECEIPT', 'PRECHECK'] : ['PRECHECK'];
  const ids = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE email_message SET status = 'SENDING', "claimedAt" = ${opts.now}
    WHERE id IN (
      SELECT id FROM email_message
      WHERE status = 'QUEUED' AND "nextAttemptAt" <= ${opts.now}
        AND purpose::text = ANY(${purposes})
      ORDER BY "queuedAt", id
      LIMIT ${opts.limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  if (ids.length === 0) return [];
  return prisma.emailMessage.findMany({
    where: { id: { in: ids.map((r) => r.id) } },
    orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }],
  });
}

async function loadAttachments(deps: DispatchDeps, refs: EmailAttachmentRef[]) {
  return Promise.all(
    refs.map(async (ref) => {
      const artifact = await deps.prisma.artifact.findUniqueOrThrow({ where: { id: ref.artifactId } });
      const content = await readFile(path.join(deps.storageDir, artifact.uri));
      return { filename: ref.filename, content, contentType: 'application/pdf' };
    }),
  );
}

async function fail(deps: DispatchDeps, message: EmailMessage, detail: string): Promise<void> {
  await withChangeLog(deps.prisma, { userId: null, reason: `email send failed: ${detail}` }, async (ctx) => {
    await ctx.tx.emailMessage.update({
      where: { id: message.id },
      data: { status: 'FAILED', statusDetail: detail, claimedAt: null },
    });
    const workItemId = await markEmailUndeliverable(ctx, { message, detail });
    if (!workItemId) {
      await ctx.log({
        subjectType: message.receiptId ? 'Receipt' : 'Contact',
        subjectId: message.receiptId ?? message.contactId,
        after: { emailMessageId: message.id, status: 'FAILED', detail },
      });
    }
  });
}

export async function dispatchPendingEmails(
  deps: DispatchDeps,
  opts: DispatchOptions = {},
): Promise<DispatchResult> {
  const { prisma } = deps;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  const maxAttempts = opts.maxAttempts ?? 6;
  const gapMs = 1000 / (opts.ratePerSecond ?? 5);
  const result: DispatchResult = { sent: 0, retrying: 0, failed: 0, heldByKillSwitch: false, dailyLimitReached: false };

  const staleBefore = new Date(now().getTime() - (opts.staleClaimMinutes ?? 10) * 60_000);
  await prisma.emailMessage.updateMany({
    where: { status: 'SENDING', claimedAt: { lt: staleBefore } },
    data: { status: 'QUEUED', claimedAt: null },
  });

  let limit = opts.limit ?? 50;
  if (opts.dailyLimit != null) {
    const sentToday = await prisma.emailMessage.count({
      where: { sentAt: { gte: new Date(now().getTime() - 24 * 60 * 60_000) } },
    });
    const remaining = Math.max(0, opts.dailyLimit - sentToday);
    if (remaining < limit) {
      limit = remaining;
      result.dailyLimitReached = true;
    }
  }
  if (limit === 0) return result;

  const killSwitch = await getKillSwitch(prisma);
  if (killSwitch.engaged) {
    result.heldByKillSwitch =
      (await prisma.emailMessage.count({ where: { status: 'QUEUED', purpose: 'RECEIPT' } })) > 0;
  }

  const claimed = await claim(prisma, { limit, now: now(), receiptsAllowed: !killSwitch.engaged });
  const touchedReceiptIds: string[] = [];

  for (const [index, message] of claimed.entries()) {
    if (index > 0) await sleep(gapMs);

    if (message.receiptId) {
      const receipt = await prisma.receipt.findUnique({ where: { id: message.receiptId } });
      if (!receipt || receipt.status !== 'ISSUED') {
        await prisma.emailMessage.update({
          where: { id: message.id },
          data: { status: 'FAILED', statusDetail: `receipt is ${receipt?.status ?? 'missing'}; not sent`, claimedAt: null },
        });
        result.failed += 1;
        continue;
      }
    }

    const attempts = message.attempts + 1;
    try {
      const attachments = await loadAttachments(deps, message.attachments as unknown as EmailAttachmentRef[]);
      const sent = await deps.provider.send({
        to: message.toAddress,
        subject: message.subject,
        text: message.textBody,
        ...(message.htmlBody ? { html: message.htmlBody } : {}),
        attachments,
        idempotencyKey: message.id,
        tags: { purpose: message.purpose.toLowerCase() },
      });
      const sentAt = now();

      if (message.receiptId) {
        await withChangeLog(prisma, { userId: null, reason: `receipt emailed to ${message.toAddress}` }, async (ctx) => {
          await ctx.tx.emailMessage.update({
            where: { id: message.id },
            data: {
              status: 'SENT',
              statusDetail: null,
              provider: deps.provider.name,
              providerMessageId: sent.providerMessageId,
              attempts,
              sentAt,
              claimedAt: null,
            },
          });
          const receipt = await ctx.tx.receipt.update({
            where: { id: message.receiptId! },
            data: { deliveredAt: sentAt },
          });
          await ctx.log({
            subjectType: 'Receipt',
            subjectId: receipt.id,
            before: { deliveredAt: null },
            after: {
              deliveredAt: receipt.deliveredAt,
              emailMessageId: message.id,
              provider: deps.provider.name,
              providerMessageId: sent.providerMessageId,
            },
          });
        });
        touchedReceiptIds.push(message.receiptId);
      } else {
        await prisma.emailMessage.update({
          where: { id: message.id },
          data: {
            status: 'SENT',
            statusDetail: null,
            provider: deps.provider.name,
            providerMessageId: sent.providerMessageId,
            attempts,
            sentAt,
            claimedAt: null,
          },
        });
      }
      result.sent += 1;
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'unknown error';
      const retryable = err instanceof EmailSendError ? err.retryable : true;
      if (retryable && attempts < maxAttempts) {
        await prisma.emailMessage.update({
          where: { id: message.id },
          data: {
            status: 'QUEUED',
            statusDetail: detail,
            attempts,
            nextAttemptAt: new Date(now().getTime() + backoffMs(attempts)),
            claimedAt: null,
          },
        });
        result.retrying += 1;
      } else {
        await prisma.emailMessage.update({ where: { id: message.id }, data: { attempts } });
        await fail(deps, message, detail);
        result.failed += 1;
      }
    }
  }

  if (touchedReceiptIds.length > 0) {
    const spaces = await prisma.receipt.findMany({
      where: { id: { in: touchedReceiptIds } },
      select: { periodId: true, ridingNumber: true, entityKind: true },
      distinct: ['periodId', 'ridingNumber', 'entityKind'],
    });
    for (const space of spaces) await advanceSpaceIfDelivered(prisma, space);
  }

  return result;
}

export interface EmailDispatcherHandle {
  stop(): Promise<void>;
}

/** Runs `dispatchPendingEmails` every `intervalMs` until stopped. Started by
 *  server.ts, never by buildApp, so tests drive passes directly. */
export function startEmailDispatcher(
  deps: DispatchDeps & { log?: { error(obj: unknown, msg: string): void } },
  opts: DispatchOptions & { intervalMs?: number } = {},
): EmailDispatcherHandle {
  let stopped = false;
  let running: Promise<unknown> = Promise.resolve();
  let timer: NodeJS.Timeout | undefined;

  const tick = () => {
    if (stopped) return;
    running = dispatchPendingEmails(deps, opts)
      .catch((err) => deps.log?.error({ err }, 'email dispatch pass failed'))
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, opts.intervalMs ?? 15_000);
      });
  };
  timer = setTimeout(tick, 0);

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}
