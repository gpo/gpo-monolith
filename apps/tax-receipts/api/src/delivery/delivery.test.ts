import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { PDFParse } from 'pdf-parse';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setKillSwitch } from '../auth/kill-switch.js';
import { withChangeLog } from '../changelog/write.js';
import { cancelReceipt } from '../corrections/cancel.js';
import { sendDonorPrechecksForSpace } from '../donors/precheck.js';
import type { Prisma } from '../generated/prisma/index.js';
import { issueReceiptsForSpace } from '../space/issuance.js';
import { getOrCreateSpaceState } from '../space/space-state.js';
import { createTestContribution, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { DevEmailProvider } from './dev-provider.js';
import { setLiveSending } from './send-mode.js';
import { dispatchPendingEmails } from './dispatcher.js';
import { EmailSendError, type EmailProvider, type OutgoingEmail } from './email-provider.js';
import { applyEmailEvents } from './events.js';
import { queueSpaceReceiptEmails } from './outbox.js';
import {
  createPrintBatch,
  markPrintBatchMailed,
  NothingToPrintError,
  PrintBatchAlreadyMailedError,
} from './print-batches.js';
import { getSpaceDeliverySummary } from './space-delivery.js';

const prisma = testPrisma();

async function extractText(bytes: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

/** Records every send; fails the first `failures` with the given error. */
class TestProvider implements EmailProvider {
  readonly name = 'test';
  readonly sent: OutgoingEmail[] = [];
  constructor(
    private failures = 0,
    private readonly error = new EmailSendError('unused', true),
  ) {}
  async send(email: OutgoingEmail) {
    if (this.failures > 0) {
      this.failures -= 1;
      throw this.error;
    }
    this.sent.push(email);
    return { providerMessageId: `test_${email.idempotencyKey}` };
  }
}

describe('receipt delivery (ticket 3.6)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let storageDir: string;
  let nextId: number;

  const SPACE = { periodId: 67, ridingNumber: null, entityKind: 'PARTY' as const };
  const LETTER = 'Thank you for your support.';
  const noSleep = async () => {};

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-delivery-test-'));
    nextId = 1;
    // live mode, so the provider is really called; the guard has its own tests
    await prisma.emailDeliverySettings.create({ data: { liveSendingEnabled: true } });
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  async function seedDonor(name: string, delivery: 'EMAIL' | 'MAIL', opts: { email?: string | null } = {}) {
    const contact = await prisma.contact.create({
      data: {
        qomonContactId: BigInt(nextId),
        name,
        email: opts.email === undefined ? `${name.split(' ')[0]!.toLowerCase()}@example.org` : opts.email,
        addresses: [
          { housenumber: '1', street: 'Main St', city: 'Toronto', state: 'ON', postalcode: 'M1M1M1', country: 'CA' },
        ] as Prisma.InputJsonValue,
      },
    });
    const contribution = await createTestContribution(prisma, {
      qomonTransactionId: BigInt(nextId++),
      contactId: contact.id,
      amountCents: 5_000,
      acceptedAt: new Date('2026-03-01T12:00:00Z'),
    });
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed' }, async (ctx) => {
      const after = await ctx.tx.contribution.update({
        where: { id: contribution.id },
        data: { periodId: SPACE.periodId, ridingNumber: null, entityKind: 'PARTY', receivedBy: 'GPO' },
      });
      await ctx.log({ subjectType: 'Contribution', subjectId: contribution.id, after });
    });
    await prisma.donorCyclePreference.create({ data: { contactId: contact.id, year: 2026, delivery } });
    return contact.id;
  }

  async function issueSpace() {
    const result = await issueReceiptsForSpace(
      { prisma, storageDir },
      { ...SPACE, actorUserId: baseline.cfoUserId, reason: 'issue', politicalEntityLabel: 'Green Party of Ontario' },
    );
    expect(result.failed).toBe(0);
    return result;
  }

  const queue = () =>
    queueSpaceReceiptEmails(prisma, {
      ...SPACE,
      actorUserId: baseline.cfoUserId,
      reason: 'send receipts',
      subject: 'Your 2026 receipt',
      coverLetterBody: LETTER,
    });

  describe('email', () => {
    it('queues each EMAIL receipt once, with the receipt attached, and moves a donor with no address to mail', async () => {
      await seedDonor('Emma Emailer', 'EMAIL');
      await seedDonor('Nora Noaddress', 'EMAIL', { email: null });
      await seedDonor('Mark Mailer', 'MAIL');
      await issueSpace();

      const first = await queue();
      expect(first.queued).toHaveLength(1);
      expect(first.queued[0]!.toAddress).toBe('emma@example.org');
      expect(first.movedToMail.map((m) => m.contactName)).toEqual(['Nora Noaddress']);

      const message = await prisma.emailMessage.findUniqueOrThrow({ where: { id: first.queued[0]!.emailMessageId } });
      expect(message).toMatchObject({ purpose: 'RECEIPT', status: 'QUEUED', subject: 'Your 2026 receipt' });
      expect(message.textBody).toContain('Emma Emailer');
      expect(message.textBody).toContain(LETTER);
      expect(message.attachments).toEqual([
        { artifactId: expect.any(String), filename: `${first.queued[0]!.receiptNumber}.pdf` },
      ]);

      // repeatable for stragglers: nothing new to queue
      const second = await queue();
      expect(second.queued).toHaveLength(0);
      expect(second.movedToMail).toHaveLength(0);
    });

    it('refuses to queue while the kill switch is engaged', async () => {
      await seedDonor('Emma Emailer', 'EMAIL');
      await issueSpace();
      await setKillSwitch(prisma, { userId: baseline.cfoUserId, reason: 'EO request' }, true);
      await expect(queue()).rejects.toThrow(/kill switch/);
    });

    it('sends queued email, records the provider id, and marks the receipt delivered', async () => {
      await seedDonor('Emma Emailer', 'EMAIL');
      const [issued] = (await issueSpace()).results;
      await queue();

      const provider = new TestProvider();
      const result = await dispatchPendingEmails({ prisma, storageDir, liveSendingAllowed: true, provider, sleep: noSleep });
      expect(result).toMatchObject({ sent: 1, retrying: 0, failed: 0 });

      expect(provider.sent).toHaveLength(1);
      const sent = provider.sent[0]!;
      expect(sent.to).toBe('emma@example.org');
      expect(sent.attachments[0]!.content.subarray(0, 4).toString()).toBe('%PDF');

      const message = await prisma.emailMessage.findFirstOrThrow();
      expect(message).toMatchObject({
        status: 'SENT',
        provider: 'test',
        providerMessageId: `test_${message.id}`,
        simulated: false,
        attempts: 1,
      });
      const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: issued!.receiptId! } });
      expect(receipt.deliveredAt).not.toBeNull();

      // every ISSUED receipt went out
      expect((await getOrCreateSpaceState(prisma, SPACE)).stage).toBe('delivered');

      // a second pass has nothing to do
      expect((await dispatchPendingEmails({ prisma, storageDir, liveSendingAllowed: true, provider, sleep: noSleep })).sent).toBe(0);
    });

    it('holds receipt email (but not pre-check email) while the kill switch is engaged', async () => {
      const contactId = await seedDonor('Emma Emailer', 'EMAIL');
      await issueSpace();
      await queue();
      await prisma.emailMessage.create({
        data: { purpose: 'PRECHECK', contactId, toAddress: 'emma@example.org', subject: 's', textBody: 't' },
      });
      await setKillSwitch(prisma, { userId: baseline.cfoUserId, reason: 'EO request' }, true);

      const provider = new TestProvider();
      const result = await dispatchPendingEmails({ prisma, storageDir, liveSendingAllowed: true, provider, sleep: noSleep });
      expect(result).toMatchObject({ sent: 1, heldByKillSwitch: true });
      expect(provider.sent.map((e) => e.subject)).toEqual(['s']);
      expect(await prisma.emailMessage.count({ where: { purpose: 'RECEIPT', status: 'QUEUED' } })).toBe(1);
    });

    it('retries a retryable failure later with the same idempotency key', async () => {
      await seedDonor('Emma Emailer', 'EMAIL');
      await issueSpace();
      await queue();
      const provider = new TestProvider(1, new EmailSendError('resend 429: slow down', true));
      let now = new Date();

      const first = await dispatchPendingEmails({ prisma, storageDir, liveSendingAllowed: true, provider, sleep: noSleep, now: () => now });
      expect(first).toMatchObject({ sent: 0, retrying: 1 });
      const waiting = await prisma.emailMessage.findFirstOrThrow();
      expect(waiting).toMatchObject({ status: 'QUEUED', attempts: 1, statusDetail: 'resend 429: slow down' });
      expect(waiting.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());

      // not due yet
      expect((await dispatchPendingEmails({ prisma, storageDir, liveSendingAllowed: true, provider, sleep: noSleep, now: () => now })).sent).toBe(0);

      now = new Date(waiting.nextAttemptAt.getTime() + 1);
      const second = await dispatchPendingEmails({ prisma, storageDir, liveSendingAllowed: true, provider, sleep: noSleep, now: () => now });
      expect(second.sent).toBe(1);
      expect(provider.sent[0]!.idempotencyKey).toBe(waiting.id);
    });

    it('stops at the daily limit', async () => {
      await seedDonor('Emma Emailer', 'EMAIL');
      await seedDonor('Eric Emailer', 'EMAIL');
      await issueSpace();
      await queue();

      const provider = new TestProvider();
      const result = await dispatchPendingEmails({ prisma, storageDir, liveSendingAllowed: true, provider, sleep: noSleep }, { dailyLimit: 1 });
      expect(result).toMatchObject({ sent: 1, dailyLimitReached: true });
      const next = await dispatchPendingEmails({ prisma, storageDir, liveSendingAllowed: true, provider, sleep: noSleep }, { dailyLimit: 1 });
      expect(next.sent).toBe(0);
    });

    it('does not send a receipt cancelled after it was queued', async () => {
      await seedDonor('Emma Emailer', 'EMAIL');
      const [issued] = (await issueSpace()).results;
      await queue();
      await cancelReceipt(
        { prisma, storageDir },
        { receiptId: issued!.receiptId!, actorUserId: baseline.cfoUserId, reason: 'wrong donor' },
      );

      const provider = new TestProvider();
      const result = await dispatchPendingEmails({ prisma, storageDir, liveSendingAllowed: true, provider, sleep: noSleep });
      expect(result.failed).toBe(1);
      expect(provider.sent).toHaveLength(0);
      expect(await prisma.workItem.count({ where: { kind: 'DELIVERY' } })).toBe(0);
    });
  });

  describe('bounces and failures', () => {
    async function sentReceiptEmail() {
      const contactId = await seedDonor('Emma Emailer', 'EMAIL');
      const [issued] = (await issueSpace()).results;
      await queue();
      await dispatchPendingEmails({ prisma, storageDir, liveSendingAllowed: true, provider: new TestProvider(), sleep: noSleep });
      const message = await prisma.emailMessage.findFirstOrThrow();
      return { contactId, receiptId: issued!.receiptId!, message };
    }

    const event = (providerMessageId: string, type: 'delivered' | 'bounced' | 'complained', id = type) => ({
      providerEventId: `evt_${id}`,
      providerMessageId,
      type,
      occurredAt: new Date(),
      detail: type === 'bounced' ? 'Permanent: General: no such mailbox' : undefined,
      payload: { type },
    });

    it('a hard bounce moves the receipt and the donor to mail and opens a DELIVERY work item', async () => {
      const { contactId, receiptId, message } = await sentReceiptEmail();

      const result = await applyEmailEvents(prisma, [event(message.providerMessageId!, 'bounced')]);
      expect(result).toEqual({ applied: 1, duplicates: 0, unknown: 0 });

      expect(await prisma.emailMessage.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({
        status: 'BOUNCED',
        statusDetail: 'Permanent: General: no such mailbox',
      });
      expect(await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } })).toMatchObject({
        delivery: 'MAIL',
        deliveredAt: null,
      });
      expect(
        await prisma.donorCyclePreference.findUniqueOrThrow({ where: { contactId_year: { contactId, year: 2026 } } }),
      ).toMatchObject({ delivery: 'MAIL' });
      const items = await prisma.workItem.findMany({ where: { kind: 'DELIVERY' } });
      expect(items).toMatchObject([{ subjectType: 'Receipt', subjectId: receiptId, contactId, status: 'OPEN' }]);

      const summary = await getSpaceDeliverySummary(prisma, SPACE);
      expect(summary.mail.readyToPrint).toBe(1);
      expect(summary.problems).toMatchObject([{ receiptId, detail: 'Permanent: General: no such mailbox' }]);
    });

    it('ignores a redelivered event and never moves a bounce back to delivered', async () => {
      const { message } = await sentReceiptEmail();
      const bounce = event(message.providerMessageId!, 'bounced');
      await applyEmailEvents(prisma, [bounce]);
      const again = await applyEmailEvents(prisma, [bounce, event(message.providerMessageId!, 'delivered')]);
      expect(again).toEqual({ applied: 1, duplicates: 1, unknown: 0 });
      expect((await prisma.emailMessage.findUniqueOrThrow({ where: { id: message.id } })).status).toBe('BOUNCED');
      expect(await prisma.workItem.count({ where: { kind: 'DELIVERY' } })).toBe(1);
      expect(await prisma.emailEvent.count()).toBe(2);
    });

    it('records delivery and complaints without moving the receipt', async () => {
      const { receiptId, message } = await sentReceiptEmail();
      await applyEmailEvents(prisma, [event(message.providerMessageId!, 'delivered')]);
      expect((await prisma.emailMessage.findUniqueOrThrow({ where: { id: message.id } })).status).toBe('DELIVERED');
      await applyEmailEvents(prisma, [event(message.providerMessageId!, 'complained')]);
      expect((await prisma.emailMessage.findUniqueOrThrow({ where: { id: message.id } })).status).toBe('COMPLAINED');
      expect((await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } })).deliveredAt).not.toBeNull();
    });

    it('counts events for messages it never sent as unknown', async () => {
      expect(await applyEmailEvents(prisma, [event('not-ours', 'delivered')])).toEqual({
        applied: 0,
        duplicates: 0,
        unknown: 1,
      });
    });

    it('a send the provider refuses for good is handled like a bounce', async () => {
      const contactId = await seedDonor('Emma Emailer', 'EMAIL');
      const [issued] = (await issueSpace()).results;
      await queue();
      const provider = new TestProvider(1, new EmailSendError('resend 422: invalid to address', false));

      const result = await dispatchPendingEmails({ prisma, storageDir, liveSendingAllowed: true, provider, sleep: noSleep });
      expect(result.failed).toBe(1);
      expect((await prisma.emailMessage.findFirstOrThrow()).status).toBe('FAILED');
      expect((await prisma.receipt.findUniqueOrThrow({ where: { id: issued!.receiptId! } })).delivery).toBe('MAIL');
      expect(await prisma.workItem.count({ where: { kind: 'DELIVERY', contactId } })).toBe(1);
    });
  });

  describe('print batches', () => {
    const print = () =>
      createPrintBatch(
        { prisma, storageDir },
        { ...SPACE, actorUserId: baseline.cfoUserId, reason: 'print run', coverLetterBody: LETTER },
      );

    it('renders a cover letter then the receipt for each MAIL receipt, and leaves EMAIL receipts out', async () => {
      await seedDonor('Mark Mailer', 'MAIL');
      await seedDonor('Mary Mailer', 'MAIL');
      await seedDonor('Emma Emailer', 'EMAIL');
      const issued = await issueSpace();

      const { printBatch, receiptCount } = await print();
      expect(receiptCount).toBe(2);

      const artifact = await prisma.artifact.findUniqueOrThrow({ where: { id: printBatch.artifactId } });
      const bytes = await readFile(path.join(storageDir, artifact.uri));
      const receiptPdf = await prisma.artifact.findFirstOrThrow({
        where: { receipts: { some: { id: issued.results[0]!.receiptId! } } },
      });
      const receiptPages = (await PDFDocument.load(await readFile(path.join(storageDir, receiptPdf.uri)))).getPageCount();
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2 * (1 + receiptPages));

      const text = await extractText(bytes);
      expect(text).toContain('Mark Mailer');
      expect(text).toContain('1 Main St');
      expect(text).toContain(LETTER);
      expect(text).not.toContain('Emma Emailer');

      // the same receipts are not printed twice while the batch is out
      await expect(print()).rejects.toBeInstanceOf(NothingToPrintError);
      expect((await getSpaceDeliverySummary(prisma, SPACE)).mail).toEqual({ readyToPrint: 0, printed: 2, mailed: 0 });
    });

    it('marking a batch mailed delivers its receipts, closes delivery work items, and advances the space', async () => {
      await seedDonor('Mark Mailer', 'MAIL');
      const { receiptId, message } = await (async () => {
        await seedDonor('Emma Emailer', 'EMAIL');
        const issued = await issueSpace();
        await queue();
        await dispatchPendingEmails({ prisma, storageDir, liveSendingAllowed: true, provider: new TestProvider(), sleep: noSleep });
        const m = await prisma.emailMessage.findFirstOrThrow();
        return { receiptId: m.receiptId!, message: m, issued };
      })();
      await applyEmailEvents(prisma, [
        {
          providerEventId: 'evt_b',
          providerMessageId: message.providerMessageId!,
          type: 'bounced',
          occurredAt: new Date(),
          payload: {},
        },
      ]);
      expect((await getOrCreateSpaceState(prisma, SPACE)).stage).toBe('issued');

      const { printBatch, receiptCount } = await print();
      expect(receiptCount).toBe(2); // the mail donor plus the bounced email

      const mailedAt = new Date(Date.now() - 60_000);
      const result = await markPrintBatchMailed(prisma, {
        printBatchId: printBatch.id,
        actorUserId: baseline.cfoUserId,
        reason: 'posted',
        mailedAt,
      });
      expect(result.deliveredCount).toBe(2);
      expect(result.closedWorkItemIds).toHaveLength(1);
      expect((await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } })).deliveredAt).toEqual(mailedAt);
      expect(await prisma.workItem.count({ where: { kind: 'DELIVERY', status: 'OPEN' } })).toBe(0);
      expect((await getOrCreateSpaceState(prisma, SPACE)).stage).toBe('delivered');

      await expect(
        markPrintBatchMailed(prisma, { printBatchId: printBatch.id, actorUserId: baseline.cfoUserId, reason: 'again' }),
      ).rejects.toBeInstanceOf(PrintBatchAlreadyMailedError);
    });

    it('does not mark a receipt cancelled after printing as delivered', async () => {
      await seedDonor('Mark Mailer', 'MAIL');
      const [issued] = (await issueSpace()).results;
      const { printBatch } = await print();
      await cancelReceipt(
        { prisma, storageDir },
        { receiptId: issued!.receiptId!, actorUserId: baseline.cfoUserId, reason: 'duplicate' },
      );

      const result = await markPrintBatchMailed(prisma, {
        printBatchId: printBatch.id,
        actorUserId: baseline.cfoUserId,
        reason: 'posted',
      });
      expect(result.deliveredCount).toBe(0);
      expect(result.skipped).toMatchObject([{ receiptId: issued!.receiptId!, status: 'CANCELLED' }]);
    });
  });

  describe('donor pre-check email', () => {
    it('queues one email per donor carrying the confirm link, replacing an earlier queued one', async () => {
      const contactId = await seedDonor('Emma Emailer', 'EMAIL');
      const send = () =>
        sendDonorPrechecksForSpace(prisma, {
          ...SPACE,
          actorUserId: baseline.cfoUserId,
          reason: 'pre-check window',
          email: {
            subject: 'Please confirm your address',
            body: 'Please confirm your mailing address.',
            confirmUrlBase: 'https://receipts.example.org/',
          },
        });

      const first = await send();
      const second = await send();
      const token = second.sent[0]!.confirmationToken;

      const messages = await prisma.emailMessage.findMany({ where: { contactId }, orderBy: { queuedAt: 'asc' } });
      expect(messages.map((m) => m.status)).toEqual(['FAILED', 'QUEUED']);
      expect(messages[0]!.id).toBe(first.sent[0]!.emailMessageId);
      expect(messages[1]!.textBody).toContain(`https://receipts.example.org/donor-precheck/${token}`);
      expect(messages[1]!).toMatchObject({ purpose: 'PRECHECK', receiptId: null, toAddress: 'emma@example.org' });
    });
  });

  describe('live-sending guard', () => {
    it('simulates every send unless the environment allows live sending', async () => {
      await seedDonor('Emma Emailer', 'EMAIL');
      const [issued] = (await issueSpace()).results;
      await queue();

      const provider = new TestProvider();
      const result = await dispatchPendingEmails({
        prisma,
        storageDir,
        provider,
        liveSendingAllowed: false,
        sleep: noSleep,
      });
      expect(result).toMatchObject({ mode: 'simulated', sent: 1 });
      expect(provider.sent).toHaveLength(0);

      const message = await prisma.emailMessage.findFirstOrThrow();
      expect(message).toMatchObject({
        status: 'SENT',
        simulated: true,
        provider: 'test',
        providerMessageId: `simulated_${message.id}`,
      });
      // the rest of the flow carries on as if it had been sent
      expect((await prisma.receipt.findUniqueOrThrow({ where: { id: issued!.receiptId! } })).deliveredAt).not.toBeNull();
      expect((await getOrCreateSpaceState(prisma, SPACE)).stage).toBe('delivered');
    });

    it('simulates when the admin toggle is off, even where live sending is allowed', async () => {
      await prisma.emailDeliverySettings.update({ where: { id: 'singleton' }, data: { liveSendingEnabled: false } });
      await seedDonor('Emma Emailer', 'EMAIL');
      await issueSpace();
      await queue();

      const provider = new TestProvider();
      const result = await dispatchPendingEmails({ prisma, storageDir, liveSendingAllowed: true, provider, sleep: noSleep });
      expect(result.mode).toBe('simulated');
      expect(provider.sent).toHaveLength(0);
    });

    it('never counts the dev provider as live', async () => {
      await seedDonor('Emma Emailer', 'EMAIL');
      await issueSpace();
      await queue();
      const result = await dispatchPendingEmails({
        prisma,
        storageDir,
        liveSendingAllowed: true,
        provider: new DevEmailProvider(),
        sleep: noSleep,
      });
      expect(result.mode).toBe('simulated');
      expect((await prisma.emailMessage.findFirstOrThrow()).simulated).toBe(true);
    });

    it('refuses to turn live sending on where the environment does not allow it, and logs a change', async () => {
      const deps = { prisma, provider: new TestProvider(), liveSendingAllowed: false };
      await expect(
        setLiveSending(deps, { userId: baseline.cfoUserId, reason: 'try it' }, true),
      ).rejects.toThrow(/not allowed in this environment/);
      await expect(
        setLiveSending({ ...deps, provider: new DevEmailProvider(), liveSendingAllowed: true }, { userId: baseline.cfoUserId, reason: 'try it' }, true),
      ).rejects.toThrow(/dev email provider/);

      const off = await setLiveSending(deps, { userId: baseline.cfoUserId, reason: 'staging stays off' }, false);
      expect(off).toMatchObject({ liveSendingEnabled: false, liveSendingAllowed: false, mode: 'simulated' });
      const on = await setLiveSending(
        { ...deps, liveSendingAllowed: true },
        { userId: baseline.cfoUserId, reason: 'go live' },
        true,
      );
      expect(on).toMatchObject({ liveSendingEnabled: true, mode: 'live', provider: 'test' });
      expect(await prisma.changeLogEntry.count({ where: { subjectType: 'EmailDeliverySettings' } })).toBe(2);
    });
  });
});
