import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { PDFParse } from 'pdf-parse';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import type { Prisma } from '../generated/prisma/index.js';
import { issueReceiptsForSpace } from '../space/issuance.js';
import { issueReceipt as issueReceiptFixture, makeContribution, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import {
  DeliveryMissingPdfError,
  DeliveryReceiptNotFoundError,
  DeliveryReceiptNotIssuedError,
  DeliveryReceiptScopeError,
  deliverSpaceReceipts,
} from './delivery.js';

const prisma = testPrisma();

async function extractText(bytes: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

describe('deliverSpaceReceipts (ticket 3.5)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let storageDir: string;
  let nextId: number;

  const SPACE = { periodId: 67, ridingNumber: null, entityKind: 'PARTY' as const };
  const COVER_LETTER = 'Thank you for your generous support of the Green Party of Ontario.';

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-delivery-test-'));
    nextId = 1;
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  async function seedContribution(name: string, delivery?: 'EMAIL' | 'MAIL', amountCents = 5_000) {
    const contact = await prisma.contact.create({
      data: {
        qomonContactId: BigInt(nextId),
        name,
        addresses: [
          { housenumber: '1', street: 'Main St', city: 'Toronto', state: 'ON', postalcode: 'M1M1M1', country: 'CA' },
        ] as Prisma.InputJsonValue,
      },
    });
    const contribution = await prisma.contribution.create({
      data: {
        qomonTransactionId: BigInt(nextId++),
        contactId: contact.id,
        amountCents,
        acceptedAt: new Date('2026-03-01T12:00:00Z'),
      },
    });
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contributionMetadata.create({
        data: {
          contributionId: contribution.id,
          periodId: SPACE.periodId,
          ridingNumber: SPACE.ridingNumber,
          entityKind: SPACE.entityKind,
          receivedBy: 'GPO',
        },
      });
      await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contribution.id, after });
    });
    if (delivery) {
      await prisma.donorCyclePreference.create({
        data: { contactId: contact.id, year: 2026, delivery },
      });
    }
    return { contactId: contact.id, contributionId: contribution.id };
  }

  async function issueSpace() {
    return issueReceiptsForSpace(
      { prisma, storageDir },
      {
        ...SPACE,
        actorUserId: baseline.cfoUserId,
        reason: 'issue for delivery test',
        politicalEntityLabel: 'Green Party of Ontario',
      },
    );
  }

  it('splits by delivery preference: one cover letter per EMAIL receipt, one consolidated PDF for all MAIL receipts', async () => {
    await seedContribution('Emma Emailer', 'EMAIL', 4_000);
    await seedContribution('Mark Mailer', 'MAIL', 6_000);
    const issued = await issueSpace();
    const receiptIds = issued.results.map((r) => r.receiptId!);

    const result = await deliverSpaceReceipts(
      { prisma, storageDir },
      { ...SPACE, receiptIds, actorUserId: baseline.cfoUserId, reason: 'deliver', coverLetterBody: COVER_LETTER },
    );

    expect(result.emailCount).toBe(1);
    expect(result.mailCount).toBe(1);
    expect(result.emailArtifacts).toHaveLength(1);
    expect(result.consolidatedPrintArtifactId).not.toBeNull();

    const emailArtifact = await prisma.artifact.findUniqueOrThrow({
      where: { id: result.emailArtifacts[0]!.coverLetterArtifactId },
    });
    const letterBytes = await readFile(path.join(storageDir, emailArtifact.uri));
    const letterText = await extractText(letterBytes);
    expect(letterText).toContain('Emma Emailer');
    expect(letterText).toContain('Thank you for your generous support');

    const printArtifact = await prisma.artifact.findUniqueOrThrow({
      where: { id: result.consolidatedPrintArtifactId! },
    });
    const printBytes = await readFile(path.join(storageDir, printArtifact.uri));
    const printDoc = await PDFDocument.load(printBytes);
    expect(printDoc.getPageCount()).toBe(1); // one mail receipt in this run

    const changeLogEntries = await prisma.changeLogEntry.findMany({
      where: { subjectType: 'Receipt', subjectId: { in: receiptIds } },
    });
    // 3 per receipt from issuance (create + pdf link... actually create writes
    // Receipt+AddressSnapshot+Allocation entries) plus 1 delivery entry each.
    const deliveryEntries = changeLogEntries.filter((e) => (e.after as { deliveryChannel?: string } | null)?.deliveryChannel);
    expect(deliveryEntries).toHaveLength(2);
  });

  it('merges every MAIL receipt into one multi-page consolidated PDF, in the given order', async () => {
    await seedContribution('Mail One', 'MAIL', 5_000);
    await seedContribution('Mail Two', 'MAIL', 3_000);
    const issued = await issueSpace();
    const receiptIds = issued.results.map((r) => r.receiptId!);

    const result = await deliverSpaceReceipts(
      { prisma, storageDir },
      { ...SPACE, receiptIds, actorUserId: baseline.cfoUserId, reason: 'deliver', coverLetterBody: COVER_LETTER },
    );

    expect(result.mailCount).toBe(2);
    expect(result.emailCount).toBe(0);
    expect(result.emailArtifacts).toHaveLength(0);

    const printArtifact = await prisma.artifact.findUniqueOrThrow({
      where: { id: result.consolidatedPrintArtifactId! },
    });
    const printBytes = await readFile(path.join(storageDir, printArtifact.uri));
    const printDoc = await PDFDocument.load(printBytes);
    expect(printDoc.getPageCount()).toBe(2);
    const printText = await extractText(printBytes);
    expect(printText).toContain('MAIL ONE');
    expect(printText).toContain('MAIL TWO');
  });

  it('rejects an unknown receipt id', async () => {
    await expect(
      deliverSpaceReceipts(
        { prisma, storageDir },
        { ...SPACE, receiptIds: ['does-not-exist'], actorUserId: baseline.cfoUserId, reason: 'x', coverLetterBody: COVER_LETTER },
      ),
    ).rejects.toBeInstanceOf(DeliveryReceiptNotFoundError);
  });

  it('rejects a receipt that belongs to a different space', async () => {
    await seedContribution('In Space', 'MAIL');
    const issued = await issueSpace();
    const receiptId = issued.results[0]!.receiptId!;

    await expect(
      deliverSpaceReceipts(
        { prisma, storageDir },
        {
          periodId: SPACE.periodId,
          ridingNumber: 84,
          entityKind: 'CA',
          receiptIds: [receiptId],
          actorUserId: baseline.cfoUserId,
          reason: 'x',
          coverLetterBody: COVER_LETTER,
        },
      ),
    ).rejects.toBeInstanceOf(DeliveryReceiptScopeError);
  });

  it('rejects a receipt that is no longer ISSUED', async () => {
    await seedContribution('Cancel Me', 'MAIL');
    const issued = await issueSpace();
    const receiptId = issued.results[0]!.receiptId!;
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'cancel' }, async (ctx) => {
      await ctx.tx.receipt.update({ where: { id: receiptId }, data: { status: 'CANCELLED' } });
      await ctx.log({ subjectType: 'Receipt', subjectId: receiptId });
    });

    await expect(
      deliverSpaceReceipts(
        { prisma, storageDir },
        { ...SPACE, receiptIds: [receiptId], actorUserId: baseline.cfoUserId, reason: 'x', coverLetterBody: COVER_LETTER },
      ),
    ).rejects.toBeInstanceOf(DeliveryReceiptNotIssuedError);
  });

  it('rejects a receipt with no rendered PDF yet', async () => {
    // The real issuance flow (issueReceipt) always sets pdfArtifactId in the
    // same call, and invariant 7 (ticket 3.3) forbids clearing it once set —
    // so this case can't be reached by cancelling a real issuance after the
    // fact. It's still reachable in practice via the raw `issueReceipt` test
    // fixture (test/db.ts), which — unlike the real service — never sets
    // pdfArtifactId at creation; used here only to exercise this guard.
    const { contactId, contributionId } = await makeContribution(prisma, {
      qomonContactId: 999n,
      qomonTransactionId: 999n,
      amountCents: 5_000,
    });
    const receiptId = await issueReceiptFixture(prisma, {
      contactId,
      contributionId,
      periodId: SPACE.periodId,
      ridingNumber: SPACE.ridingNumber,
      entityKind: SPACE.entityKind,
      amountCents: 5_000,
      actorUserId: baseline.cfoUserId,
    });

    await expect(
      deliverSpaceReceipts(
        { prisma, storageDir },
        { ...SPACE, receiptIds: [receiptId], actorUserId: baseline.cfoUserId, reason: 'x', coverLetterBody: COVER_LETTER },
      ),
    ).rejects.toBeInstanceOf(DeliveryMissingPdfError);
  });
});
