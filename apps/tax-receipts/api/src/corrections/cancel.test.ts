import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setKillSwitch } from '../auth/kill-switch.js';
import { withChangeLog } from '../changelog/write.js';
import type { Prisma } from '../generated/prisma/index.js';
import { generateDc1aAmendment } from '../rtd/dc1a.js';
import { markRtdFilingSent } from '../rtd/mark-sent.js';
import { prepareRtdFiling } from '../rtd/prepare.js';
import { IssuanceDisabledError } from '../auth/kill-switch.js';
import { MissingAddressError, issueReceipt } from '../receipts/issue.js';
import { TerminalReceiptError } from '../receipts/allocate.js';
import { resetDb, seedBaseline, testPrisma, createTestContribution } from '../test/db.js';
import { cancelReceipt, previewReceiptCorrection, reissueReceipt } from './cancel.js';

const prisma = testPrisma();

describe('correction actions 1 & 2: cancel / reissue (ticket 3.10)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let storageDir: string;
  let nextTransactionId: number;
  let nextContactId: bigint;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-corrections-test-'));
    nextTransactionId = 1;
    nextContactId = 1n;
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  async function seedContact(addresses: unknown[] = [
    { housenumber: '1', street: 'Main St', city: 'Toronto', state: 'ON', postalcode: 'M1M1M1', country: 'CA' },
  ]) {
    const id = nextContactId++;
    return prisma.contact.create({
      data: { qomonContactId: id, name: 'Dana Donor', addresses: addresses as Prisma.InputJsonValue },
    });
  }

  async function seedContribution(contactId: string, amountCents = 5_000) {
    return createTestContribution(prisma, {
        qomonTransactionId: BigInt(nextTransactionId++),
        contactId,
        amountCents,
        acceptedAt: new Date('2026-03-01T12:00:00Z'),
      });
  }

  async function seedMetadata(contributionId: string, overrides: Record<string, unknown> = {}) {
    return withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contribution.update({ where: { id: contributionId }, data: { periodId: baseline.periodId, entityKind: 'PARTY', receivedBy: 'GPO', ...overrides } });
      await ctx.log({ subjectType: 'Contribution', subjectId: contributionId, after });
      return after;
    });
  }

  async function issue(contributionId: string, amountCents?: number) {
    return issueReceipt(
      { prisma, storageDir },
      {
        contributionId,
        actorUserId: baseline.cfoUserId,
        reason: 'issue for correction test',
        politicalEntityLabel: 'Green Party of Ontario',
        amountCents,
      },
    );
  }

  it('cancels a receipt: status flips, allocation is released for a fresh receipt, a watermarked copy is stored', async () => {
    const contact = await seedContact();
    const contribution = await seedContribution(contact.id);
    await seedMetadata(contribution.id);
    const issued = await issue(contribution.id);

    const result = await cancelReceipt(
      { prisma, storageDir },
      { receiptId: issued.id, actorUserId: baseline.adminUserId, reason: 'donor no longer eligible' },
    );

    expect(result.owedToEoWorkItemIds).toEqual([]);
    expect(result.cancellationNoticeArtifactId).not.toBeNull();

    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: issued.id } });
    expect(receipt.status).toBe('CANCELLED');

    const artifact = await prisma.artifact.findUniqueOrThrow({ where: { id: result.cancellationNoticeArtifactId! } });
    const bytes = await import('node:fs/promises').then((fs) => fs.readFile(path.join(storageDir, artifact.uri)));
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);

    // Releasing the allocation needs no write of its own -- a fresh receipt
    // for the full amount is issuable again immediately.
    const reissued = await issue(contribution.id);
    expect(reissued.amountCents).toBe(5_000);
  });

  it('404s an unknown receipt, and 409s an already-cancelled one', async () => {
    await expect(
      cancelReceipt({ prisma, storageDir }, { receiptId: 'nope', actorUserId: baseline.adminUserId, reason: 'x' }),
    ).rejects.toMatchObject({ name: 'ReceiptNotFoundError' });

    const contact = await seedContact();
    const contribution = await seedContribution(contact.id);
    await seedMetadata(contribution.id);
    const issued = await issue(contribution.id);
    await cancelReceipt({ prisma, storageDir }, { receiptId: issued.id, actorUserId: baseline.adminUserId, reason: 'first cancel' });

    await expect(
      cancelReceipt({ prisma, storageDir }, { receiptId: issued.id, actorUserId: baseline.adminUserId, reason: 'second cancel' }),
    ).rejects.toBeInstanceOf(TerminalReceiptError);
  });

  it('cancels a receipt with no PDF (a foreign receipt) without error, and stores no cancellation artifact', async () => {
    const contact = await seedContact();
    const contribution = await seedContribution(contact.id);
    await seedMetadata(contribution.id);
    const foreign = await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed foreign' }, async (ctx) => {
      const snapshot = await ctx.tx.addressSnapshot.create({
        data: { contactId: contact.id, periodId: baseline.periodId, line1: '1 Main St', city: 'Toronto', province: 'ON', postalCode: 'M1M1M1', source: 'test' },
      });
      const receipt = await ctx.tx.receipt.create({
        data: {
          receiptNumber: 'EOSTOCK-1', numberSource: 'FOREIGN', entityKind: 'PARTY', periodId: baseline.periodId,
          issueDate: new Date(), contactId: contact.id, contactNameSnapshot: contact.name, addressSnapshotId: snapshot.id,
        },
      });
      const allocation = await ctx.tx.receiptAllocation.create({ data: { receiptId: receipt.id, contributionId: contribution.id, amountCents: 5_000 } });
      await ctx.log({ subjectType: 'Receipt', subjectId: receipt.id, after: receipt });
      await ctx.log({ subjectType: 'ReceiptAllocation', subjectId: allocation.id, after: allocation });
      return receipt;
    });

    const result = await cancelReceipt(
      { prisma, storageDir },
      { receiptId: foreign.id, actorUserId: baseline.adminUserId, reason: 'recorded in error' },
    );
    expect(result.cancellationNoticeArtifactId).toBeNull();
  });

  it('opens an OWED_TO_EO work item for an RTD-reported allocation, resolvable via the real DC-1A generator', async () => {
    const contact = await seedContact();
    const contribution = await seedContribution(contact.id, 25_000);
    await seedMetadata(contribution.id);
    const issued = await issue(contribution.id);

    const prepared = await prepareRtdFiling(
      { prisma, storageDir },
      { year: 2026, contributionIds: [contribution.id], actorUserId: baseline.cfoUserId, reason: 'initial filing', cfoName: 'Casey CFO' },
    );
    await markRtdFilingSent(prisma, { rtdFilingId: prepared.rtdFilingId, actorUserId: baseline.cfoUserId, reason: 'emailed to EO' });

    const preview = await previewReceiptCorrection(prisma, issued.id);
    expect(preview.owedToEoCount).toBe(1);
    expect(preview.contributions).toEqual([{ contributionId: contribution.id, amountCents: 25_000, rtdReported: true }]);

    const result = await cancelReceipt(
      { prisma, storageDir },
      { receiptId: issued.id, actorUserId: baseline.adminUserId, reason: 'wrong amount' },
    );
    expect(result.owedToEoWorkItemIds).toHaveLength(1);

    const workItem = await prisma.workItem.findUniqueOrThrow({ where: { id: result.owedToEoWorkItemIds[0]! } });
    expect(workItem.kind).toBe('OWED_TO_EO');
    expect(workItem.status).toBe('OPEN');
    expect(workItem.subjectId).toBe(contribution.id);

    // The queue's other end (ticket 2.4) already knows how to resolve this.
    const amendment = await generateDc1aAmendment(
      { prisma, storageDir },
      { contributionId: contribution.id, actorUserId: baseline.cfoUserId, reason: 'wrong amount', workItemId: workItem.id },
    );
    expect(amendment.rtdFilingId).toBeTruthy();
    const closed = await prisma.workItem.findUniqueOrThrow({ where: { id: workItem.id } });
    expect(closed.status).toBe('RESOLVED');
  });

  it('reissues a single-contribution receipt: cancels the old, links it to a fresh replacement, renders a new PDF', async () => {
    const contact = await seedContact();
    const contribution = await seedContribution(contact.id, 5_000);
    await seedMetadata(contribution.id);
    const issued = await issue(contribution.id);

    const result = await reissueReceipt(
      { prisma, storageDir },
      { receiptId: issued.id, actorUserId: baseline.cfoUserId, reason: 'wrong amount corrected', politicalEntityLabel: 'Green Party of Ontario' },
    );

    expect(result.newReceiptNumber).toBe('GPO-00402511');
    expect(result.newReceiptAmountCents).toBe(5_000);

    const oldReceipt = await prisma.receipt.findUniqueOrThrow({ where: { id: issued.id } });
    expect(oldReceipt.status).toBe('CANCELLED');
    expect(oldReceipt.replacedById).toBe(result.newReceiptId);

    const newReceipt = await prisma.receipt.findUniqueOrThrow({ where: { id: result.newReceiptId }, include: { pdfArtifact: true, allocations: true } });
    expect(newReceipt.reissuedFromId).toBe(issued.id);
    expect(newReceipt.pdfArtifact).not.toBeNull();
    expect(newReceipt.allocations).toHaveLength(1);
    expect(newReceipt.allocations[0]!.amountCents).toBe(5_000);
  });

  it('reissues a multi-allocation receipt, carrying every contribution over to one new receipt', async () => {
    const contact = await seedContact();
    const first = await seedContribution(contact.id, 4_000);
    const second = await seedContribution(contact.id, 2_500);
    await seedMetadata(first.id);
    await seedMetadata(second.id);
    const issued = await issue(first.id);

    const { allocateToReceipt } = await import('../receipts/allocate.js');
    await allocateToReceipt(
      { prisma },
      { receiptId: issued.id, contributionId: second.id, actorUserId: baseline.cfoUserId, reason: 'consolidate' },
    );

    const preview = await previewReceiptCorrection(prisma, issued.id);
    expect(preview.totalAmountCents).toBe(6_500);
    expect(preview.contributions).toHaveLength(2);

    const result = await reissueReceipt(
      { prisma, storageDir },
      { receiptId: issued.id, actorUserId: baseline.cfoUserId, reason: 'material fix', politicalEntityLabel: 'Green Party of Ontario' },
    );

    expect(result.newReceiptAmountCents).toBe(6_500);
    const newReceipt = await prisma.receipt.findUniqueOrThrow({ where: { id: result.newReceiptId }, include: { allocations: true } });
    expect(newReceipt.allocations.map((a) => a.contributionId).sort()).toEqual([first.id, second.id].sort());
  });

  it('423s a reissue while the kill switch is engaged (cancel-only is unaffected)', async () => {
    const contact = await seedContact();
    const contribution = await seedContribution(contact.id);
    await seedMetadata(contribution.id);
    const issued = await issue(contribution.id);

    await setKillSwitch(prisma, { userId: baseline.cfoUserId, reason: 'EO request' }, true);

    await expect(
      reissueReceipt(
        { prisma, storageDir },
        { receiptId: issued.id, actorUserId: baseline.cfoUserId, reason: 'blocked', politicalEntityLabel: 'Green Party of Ontario' },
      ),
    ).rejects.toBeInstanceOf(IssuanceDisabledError);

    // Cancel-only doesn't mint a new number, so the statutory freeze doesn't apply to it.
    const cancelled = await cancelReceipt({ prisma, storageDir }, { receiptId: issued.id, actorUserId: baseline.adminUserId, reason: 'still cancellable' });
    expect(cancelled.receiptId).toBe(issued.id);
  });

  it('422s a reissue when the address on file is missing required fields', async () => {
    const contact = await seedContact();
    const contribution = await seedContribution(contact.id);
    await seedMetadata(contribution.id);
    const issued = await issue(contribution.id);

    // The address was fine at issuance; simulate it going stale/incomplete
    // in Qomon before the correction runs (reissue re-derives address fresh
    // from the live cache, per corrections.md action 2).
    await prisma.contact.update({
      where: { id: contact.id },
      data: { addresses: [{ housenumber: '1', street: 'Main St', country: 'CA' }] as Prisma.InputJsonValue },
    });

    await expect(
      reissueReceipt(
        { prisma, storageDir },
        { receiptId: issued.id, actorUserId: baseline.cfoUserId, reason: 'address missing', politicalEntityLabel: 'Green Party of Ontario' },
      ),
    ).rejects.toBeInstanceOf(MissingAddressError);
  });

  it('reissues a partially-allocated contribution for exactly what remains, unaffected by another receipt already covering the rest', async () => {
    const contact = await seedContact();
    const contribution = await seedContribution(contact.id, 5_000);
    await seedMetadata(contribution.id);
    // Split across two receipts up front (a real, if unusual, case: two
    // partial receipts against one contribution). Invariant 1 guarantees
    // reissuing one can never be starved by the other -- see cancel.ts's
    // comment on the `lines` loop for why that guard is provably
    // unreachable rather than untested.
    const receiptA = await issue(contribution.id, 3_000);
    await issue(contribution.id, 2_000);

    const result = await reissueReceipt(
      { prisma, storageDir },
      { receiptId: receiptA.id, actorUserId: baseline.cfoUserId, reason: 'address fix on the partial receipt', politicalEntityLabel: 'Green Party of Ontario' },
    );

    expect(result.newReceiptAmountCents).toBe(3_000);
  });
});
