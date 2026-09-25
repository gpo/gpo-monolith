import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import { TerminalReceiptError } from '../receipts/allocate.js';
import { issueReceipt } from '../receipts/issue.js';
import { createTestContribution, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { cancelReceipt } from './cancel.js';
import { MaterialChangeError, ReprintNotAllowedError, isSpellingFix, reprintReceipt } from './reprint.js';

const prisma = testPrisma();

async function pdfText(bytes: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

describe('reprint without cancelling: lost copy and spelling fix (corrections action 3, ticket 3.11)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let storageDir: string;
  let receiptId: string;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-reprint-test-'));
    const contact = await prisma.contact.create({
      data: {
        qomonContactId: 1n,
        name: 'Dana Donor',
        addresses: [{ housenumber: '1', street: 'Main St', city: 'Toronto', state: 'ON', postalcode: 'M1M1M1', country: 'CA' }],
      },
    });
    const contribution = await createTestContribution(prisma, {
      qomonTransactionId: 1n,
      contactId: contact.id,
      amountCents: 12_345,
      acceptedAt: new Date('2026-03-01T12:00:00Z'),
    });
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contribution.update({
        where: { id: contribution.id },
        data: { periodId: baseline.periodId, entityKind: 'PARTY', receivedBy: 'GPO' },
      });
      await ctx.log({ subjectType: 'Contribution', subjectId: contribution.id, after });
    });
    const issued = await issueReceipt(
      { prisma, storageDir },
      { contributionId: contribution.id, actorUserId: baseline.cfoUserId, reason: 'issue', politicalEntityLabel: 'Green Party of Ontario' },
    );
    receiptId = issued.id;
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  const base = () => ({
    receiptId,
    actorUserId: baseline.cfoUserId,
    reason: 'donor request',
    politicalEntityLabel: 'Green Party of Ontario',
  });

  async function artifactText(artifactId: string) {
    const artifact = await prisma.artifact.findUniqueOrThrow({ where: { id: artifactId } });
    return pdfText(await readFile(path.join(storageDir, artifact.uri)));
  }

  it('reprints a lost receipt unaltered, stamped COPY, and flags the original lost', async () => {
    const before = await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } });

    const result = await reprintReceipt({ prisma, storageDir }, { ...base(), kind: 'LOST_COPY' });

    expect(result.lost).toBe(true);
    const text = await artifactText(result.artifactId);
    expect(text.split('COPY').length - 1).toBe(3);
    expect(text).toContain(before.receiptNumber);
    expect(text).toContain('$123.45');
    expect(text).not.toContain('cancels and replaces');

    const after = await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } });
    expect(after.lost).toBe(true);
    expect(after.status).toBe('ISSUED');
    expect(after.pdfArtifactId).toBe(before.pdfArtifactId); // the original PDF is untouched (invariant 7)
    expect(after.contactNameSnapshot).toBe(before.contactNameSnapshot);

    const rows = await prisma.receiptReprint.findMany({ where: { receiptId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'LOST_COPY', correctedName: null, reason: 'donor request' });
  });

  it('can reprint a lost receipt again', async () => {
    await reprintReceipt({ prisma, storageDir }, { ...base(), kind: 'LOST_COPY' });
    await reprintReceipt({ prisma, storageDir }, { ...base(), kind: 'LOST_COPY' });
    expect(await prisma.receiptReprint.count({ where: { receiptId } })).toBe(2);
  });

  it('regenerates the receipt with a corrected spelling, without stamping COPY or cancelling', async () => {
    const result = await reprintReceipt({ prisma, storageDir }, { ...base(), kind: 'CORRECTED', correctedName: 'Dana Doner' });

    expect(result.lost).toBe(false);
    const text = await artifactText(result.artifactId);
    expect(text).toContain('DANA DONER');
    expect(text).not.toContain('COPY');

    const after = await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } });
    expect(after.status).toBe('ISSUED');
    expect(after.lost).toBe(false);
    expect(after.contactNameSnapshot).toBe('Dana Donor');
    const row = await prisma.receiptReprint.findFirstOrThrow({ where: { receiptId } });
    expect(row.correctedName).toBe('Dana Doner');
  });

  it('refuses a "spelling fix" that changes who the donor is: that is a reissue', async () => {
    await expect(
      reprintReceipt({ prisma, storageDir }, { ...base(), kind: 'CORRECTED', correctedName: 'Robin Recipient' }),
    ).rejects.toBeInstanceOf(MaterialChangeError);
    expect(await prisma.receiptReprint.count()).toBe(0);
  });

  it('refuses the wrong inputs for each kind', async () => {
    await expect(reprintReceipt({ prisma, storageDir }, { ...base(), kind: 'CORRECTED' })).rejects.toBeInstanceOf(ReprintNotAllowedError);
    await expect(
      reprintReceipt({ prisma, storageDir }, { ...base(), kind: 'CORRECTED', correctedName: 'Dana Donor' }),
    ).rejects.toBeInstanceOf(ReprintNotAllowedError);
    await expect(
      reprintReceipt({ prisma, storageDir }, { ...base(), kind: 'LOST_COPY', correctedName: 'Dana Doner' }),
    ).rejects.toBeInstanceOf(ReprintNotAllowedError);
  });

  it('refuses a cancelled receipt', async () => {
    await cancelReceipt({ prisma, storageDir }, { receiptId, actorUserId: baseline.adminUserId, reason: 'cancel first' });
    await expect(reprintReceipt({ prisma, storageDir }, { ...base(), kind: 'LOST_COPY' })).rejects.toBeInstanceOf(TerminalReceiptError);
  });

  it('refuses a receipt issued outside the tool', async () => {
    // numberSource is frozen after issuance (invariant 7), so a foreign receipt has to be created as one
    const foreign = await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed foreign' }, async (ctx) => {
      const original = await ctx.tx.receipt.findUniqueOrThrow({ where: { id: receiptId } });
      const receipt = await ctx.tx.receipt.create({
        data: {
          receiptNumber: 'EOSTOCK-9',
          numberSource: 'FOREIGN',
          entityKind: 'PARTY',
          periodId: baseline.periodId,
          issueDate: new Date(),
          contactId: original.contactId,
          contactNameSnapshot: original.contactNameSnapshot,
          addressSnapshotId: original.addressSnapshotId,
        },
      });
      await ctx.log({ subjectType: 'Receipt', subjectId: receipt.id, after: receipt });
      return receipt;
    });
    await expect(
      reprintReceipt({ prisma, storageDir }, { ...base(), receiptId: foreign.id, kind: 'LOST_COPY' }),
    ).rejects.toBeInstanceOf(ReprintNotAllowedError);
  });
});

describe('isSpellingFix', () => {
  it.each([
    ['Dana Donor', 'Dana Doner', true],
    ['Jon Smyth', 'John Smith', true],
    ['José García', 'Jose Garcia', true], // accents alone are not a different person
    ['Dana Donor', 'dana  donor', true],
    ['Dana Donor', 'Robin Recipient', false],
    ['Val T.', 'Valerie T.', false], // a different name form is a merge question
    ['Dana Donor', '', false],
  ])('%s -> %s is %s', (from, to, expected) => {
    expect(isSpellingFix(from, to)).toBe(expected);
  });
});
