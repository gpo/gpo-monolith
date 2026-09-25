import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import { allocateToReceipt, TerminalReceiptError } from '../receipts/allocate.js';
import { issueReceipt } from '../receipts/issue.js';
import { markRtdFilingSent } from '../rtd/mark-sent.js';
import { prepareRtdFiling } from '../rtd/prepare.js';
import { createTestContribution, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { cancelReceipt } from './cancel.js';
import { CorrectionBlockedError, CorrectionValidationError } from './contribution-correction.js';
import { previewReceiptSplit, splitReceipt } from './receipt-split.js';

const prisma = testPrisma();

async function pdfText(bytes: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

describe('correction action 7: split a receipt', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let storageDir: string;
  let contactId: string;
  let first: string;
  let second: string;
  let receiptId: string;
  let nextTx: bigint;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-split-test-'));
    nextTx = 1n;
    const contact = await prisma.contact.create({
      data: {
        qomonContactId: 1n,
        name: 'Dana Donor',
        addresses: [{ housenumber: '1', street: 'Main St', city: 'Toronto', state: 'ON', postalcode: 'M1M1M1', country: 'CA' }],
      },
    });
    contactId = contact.id;
    first = await seedContribution(25_000); // over the $200 RTD threshold on its own
    second = await seedContribution(2_500);
    const issued = await issueReceipt(
      { prisma, storageDir },
      { contributionId: first, actorUserId: baseline.cfoUserId, reason: 'issue', politicalEntityLabel: 'Green Party of Ontario' },
    );
    receiptId = issued.id;
    await allocateToReceipt(
      { prisma },
      { receiptId, contributionId: second, actorUserId: baseline.cfoUserId, reason: 'consolidate' },
    );
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  async function seedContribution(amountCents: number) {
    const contribution = await createTestContribution(prisma, {
      qomonTransactionId: nextTx++,
      contactId,
      amountCents,
      acceptedAt: new Date('2026-03-01T12:00:00Z'),
    });
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contribution.update({
        where: { id: contribution.id },
        data: { periodId: baseline.periodId, entityKind: 'PARTY', receivedBy: 'GPO' },
      });
      await ctx.log({ subjectType: 'Contribution', subjectId: contribution.id, after });
    });
    return contribution.id;
  }

  const input = () => ({
    receiptId,
    actorUserId: baseline.cfoUserId,
    reason: 'donor wants two receipts',
    politicalEntityLabel: 'Green Party of Ontario',
    groups: [{ contributionIds: [first] }, { contributionIds: [second] }],
  });

  it('cancels the receipt and issues one per group, each saying it replaces the original', async () => {
    const original = await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } });

    const result = await splitReceipt({ prisma, storageDir }, input());

    expect(result.cancelledReceiptIds).toEqual([receiptId]);
    expect(result.issuedReceipts).toHaveLength(2);
    expect(result.issuedReceipts.map((r) => r.amountCents)).toEqual([25_000, 2_500]);
    expect(result.supersededContributionIds).toEqual([]);

    const after = await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } });
    expect(after.status).toBe('CANCELLED');
    expect(after.replacedById).toBe(result.issuedReceipts[0]!.id);
    const reissued = await prisma.receipt.findMany({ where: { reissuedFromId: receiptId }, include: { pdfArtifact: true, allocations: true } });
    expect(reissued).toHaveLength(2);
    for (const r of reissued) {
      expect(r.contactId).toBe(contactId);
      expect(r.allocations).toHaveLength(1);
      const text = await pdfText(await readFile(path.join(storageDir, r.pdfArtifact!.uri)));
      expect(text.split(`This cancels and replaces receipt #${original.receiptNumber}`).length - 1).toBe(3);
    }
    // consecutive numbers from the one sequence
    const numbers = result.issuedReceipts.map((r) => Number(r.receiptNumber.replace('GPO-', '')));
    expect(numbers[1]).toBe(numbers[0]! + 1);

    // the contributions did not change
    const rows = await prisma.contribution.findMany({ where: { id: { in: [first, second] } } });
    expect(rows.every((r) => r.status === 'ACTIVE')).toBe(true);
  });

  it('previews without writing anything', async () => {
    const plan = await previewReceiptSplit(prisma, input());
    expect(plan.action).toBe('SPLIT_RECEIPT');
    expect(plan.cancelReceipts).toHaveLength(1);
    expect(plan.issueReceipts.map((r) => r.totalAmountCents)).toEqual([25_000, 2_500]);
    expect(await prisma.receipt.count()).toBe(1);
    expect((await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } })).status).toBe('ISSUED');
  });

  it('does not queue a DC-1A for RTD-reported contributions: only the receipts change', async () => {
    const prepared = await prepareRtdFiling(
      { prisma, storageDir },
      { year: 2026, contributionIds: [first], actorUserId: baseline.cfoUserId, reason: 'file', cfoName: 'Casey CFO' },
    );
    await markRtdFilingSent(prisma, { rtdFilingId: prepared.rtdFilingId, actorUserId: baseline.cfoUserId, reason: 'sent' });

    await splitReceipt({ prisma, storageDir }, input());

    expect(await prisma.workItem.count({ where: { kind: 'OWED_TO_EO' } })).toBe(0);
  });

  it('queues a return note when the receipt is inside a filed report', async () => {
    const report = await prisma.entityReport.create({
      data: {
        periodId: baseline.periodId,
        kind: 'ALL',
        entityKind: 'PARTY',
        filedAt: new Date(),
        receiptLinks: { create: { receiptId } },
      },
    });
    const plan = await previewReceiptSplit(prisma, input());
    expect(plan.dirtyReports).toEqual([{ entityReportId: report.id, kind: 'ALL', periodId: baseline.periodId, filed: true }]);

    await splitReceipt({ prisma, storageDir }, input());
    const notes = await prisma.workItem.findMany({ where: { kind: 'OWED_TO_EO', ruleRef: 'corrections-return-note' } });
    expect(notes).toHaveLength(3); // the cancelled receipt and each of the two new ones
  });

  it('demands at least two groups that together cover exactly the receipt', async () => {
    await expect(splitReceipt({ prisma, storageDir }, { ...input(), groups: [{ contributionIds: [first, second] }] })).rejects.toBeInstanceOf(
      CorrectionValidationError,
    );
    await expect(splitReceipt({ prisma, storageDir }, { ...input(), groups: [{ contributionIds: [first] }, { contributionIds: [] }] })).rejects.toBeInstanceOf(
      CorrectionValidationError,
    );
    await expect(
      splitReceipt({ prisma, storageDir }, { ...input(), groups: [{ contributionIds: [first] }, { contributionIds: [first] }] }),
    ).rejects.toBeInstanceOf(CorrectionValidationError);
    await expect(
      splitReceipt({ prisma, storageDir }, { ...input(), groups: [{ contributionIds: [first] }, { contributionIds: ['nope'] }] }),
    ).rejects.toBeInstanceOf(CorrectionValidationError);
    // nothing was cancelled by any of those
    expect((await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } })).status).toBe('ISSUED');
  });

  it('will not split a cancelled receipt', async () => {
    await cancelReceipt({ prisma, storageDir }, { receiptId, actorUserId: baseline.adminUserId, reason: 'cancel first' });
    await expect(splitReceipt({ prisma, storageDir }, input())).rejects.toBeInstanceOf(TerminalReceiptError);
  });

  it('is blocked, before any write, when the donor has no printable address', async () => {
    await prisma.contact.update({ where: { id: contactId }, data: { addresses: [] } });
    const plan = await previewReceiptSplit(prisma, input());
    expect(plan.blockers[0]).toContain('Dana Donor is missing');
    await expect(splitReceipt({ prisma, storageDir }, input())).rejects.toBeInstanceOf(CorrectionBlockedError);
    expect((await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } })).status).toBe('ISSUED');
  });
});
