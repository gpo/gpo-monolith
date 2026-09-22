import { beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import { issueReceipt, makeContribution, resetDb, seedBaseline, testPrisma } from '../test/db.js';

const prisma = testPrisma();

/**
 * Database invariant 7 (ticket 3.3): an AddressSnapshot referenced by a
 * receipt is immutable, and a receipt's own core facts never change after
 * issuance (corrections.md principle 1: "A receipt record, once generated,
 * never changes; corrections produce new records"). DB triggers added in
 * `prisma/migrations/20260922150000_invariant_7_receipt_immutability`.
 * Invariant 3's receiptNumber-immutability clause already has its own tests
 * in `db-invariants.test.ts` (ticket 0.3); this file covers everything else.
 */
describe('database invariant 7 (ticket 3.3) rejects bad writes', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
  });

  async function seedIssuedReceipt(qomonId: bigint) {
    const { contactId, contributionId } = await makeContribution(prisma, {
      qomonContactId: qomonId,
      qomonTransactionId: qomonId,
      amountCents: 5_000,
    });
    const receiptId = await issueReceipt(prisma, {
      contactId,
      contributionId,
      periodId: baseline.periodId,
      amountCents: 5_000,
      actorUserId: baseline.cfoUserId,
    });
    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } });
    return { contactId, contributionId, receiptId, addressSnapshotId: receipt.addressSnapshotId };
  }

  it('an address snapshot referenced by a receipt cannot be updated or deleted', async () => {
    const { addressSnapshotId } = await seedIssuedReceipt(1n);

    await expect(
      prisma.$executeRaw`UPDATE address_snapshot SET city = 'Tampered' WHERE id = ${addressSnapshotId}`,
    ).rejects.toThrow(/invariant 7/);
    await expect(
      prisma.$executeRaw`DELETE FROM address_snapshot WHERE id = ${addressSnapshotId}`,
    ).rejects.toThrow(/invariant 7/);

    const stillThere = await prisma.addressSnapshot.findUniqueOrThrow({ where: { id: addressSnapshotId } });
    expect(stillThere.city).not.toBe('Tampered');
  });

  it('an unreferenced address snapshot may still be edited or removed', async () => {
    const snapshot = await prisma.addressSnapshot.create({
      data: {
        contactId: (await makeContribution(prisma, { qomonContactId: 2n, qomonTransactionId: 2n, amountCents: 1_000 })).contactId,
        periodId: baseline.periodId,
        line1: '1 Test St',
        city: 'Toronto',
        province: 'ON',
        postalCode: 'M1M1M1',
        source: 'test',
      },
    });
    await expect(
      prisma.addressSnapshot.update({ where: { id: snapshot.id }, data: { city: 'Ottawa' } }),
    ).resolves.toMatchObject({ city: 'Ottawa' });
    await expect(prisma.addressSnapshot.delete({ where: { id: snapshot.id } })).resolves.toBeDefined();
  });

  it("a receipt's core identity fields are immutable once issued", async () => {
    const { receiptId } = await seedIssuedReceipt(3n);

    await expect(
      prisma.$executeRaw`UPDATE receipt SET "ridingNumber" = 999 WHERE id = ${receiptId}`,
    ).rejects.toThrow(/invariant 7/);
    await expect(
      prisma.$executeRaw`UPDATE receipt SET "entityKind" = 'CA' WHERE id = ${receiptId}`,
    ).rejects.toThrow(/invariant 7/);
    await expect(
      prisma.$executeRaw`UPDATE receipt SET "contactNameSnapshot" = 'Tampered' WHERE id = ${receiptId}`,
    ).rejects.toThrow(/invariant 7/);
  });

  it('a cancelled receipt status is terminal — cannot move to VOID or back to ISSUED', async () => {
    const { receiptId } = await seedIssuedReceipt(4n);

    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'cancel' }, async (ctx) => {
      await ctx.tx.receipt.update({ where: { id: receiptId }, data: { status: 'CANCELLED' } });
      await ctx.log({ subjectType: 'Receipt', subjectId: receiptId });
    });

    await expect(
      withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'un-cancel' }, async (ctx) => {
        await ctx.tx.receipt.update({ where: { id: receiptId }, data: { status: 'ISSUED' } });
        await ctx.log({ subjectType: 'Receipt', subjectId: receiptId });
      }),
    ).rejects.toThrow(/invariant 7/);
    await expect(
      withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'also void?' }, async (ctx) => {
        await ctx.tx.receipt.update({ where: { id: receiptId }, data: { status: 'VOID' } });
        await ctx.log({ subjectType: 'Receipt', subjectId: receiptId });
      }),
    ).rejects.toThrow(/invariant 7/);
  });

  it('pdfArtifactId and replacedById are one-time-settable, then frozen', async () => {
    const first = await seedIssuedReceipt(5n);
    const second = await seedIssuedReceipt(6n);

    // The test-fixture `issueReceipt` (test/db.ts) doesn't set pdfArtifactId
    // at creation the way the real service (ticket 3.1) does in its
    // follow-up write — set it here first so the *second* change below is
    // actually a second change, not the first one.
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'attach pdf' }, async (ctx) => {
      const firstArtifact = await ctx.tx.artifact.create({ data: { kind: 'PDF', uri: 'x', sha256: '0'.repeat(64) } });
      await ctx.tx.receipt.update({ where: { id: first.receiptId }, data: { pdfArtifactId: firstArtifact.id } });
      await ctx.log({ subjectType: 'Receipt', subjectId: first.receiptId });
    });

    await expect(
      withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'swap pdf' }, async (ctx) => {
        const artifact = await ctx.tx.artifact.create({ data: { kind: 'PDF', uri: 'x', sha256: '1'.repeat(64) } });
        await ctx.tx.receipt.update({ where: { id: first.receiptId }, data: { pdfArtifactId: artifact.id } });
        await ctx.log({ subjectType: 'Receipt', subjectId: first.receiptId });
      }),
    ).rejects.toThrow(/invariant 7/);

    // replacedById: first time is allowed (a later reissue pointing back), second time is not.
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'link replacement' }, async (ctx) => {
      await ctx.tx.receipt.update({ where: { id: first.receiptId }, data: { replacedById: second.receiptId } });
      await ctx.log({ subjectType: 'Receipt', subjectId: first.receiptId });
    });
    const third = await seedIssuedReceipt(7n);
    await expect(
      withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 're-link' }, async (ctx) => {
        await ctx.tx.receipt.update({ where: { id: first.receiptId }, data: { replacedById: third.receiptId } });
        await ctx.log({ subjectType: 'Receipt', subjectId: first.receiptId });
      }),
    ).rejects.toThrow(/invariant 7/);
  });

  it('a receipt cannot be un-flagged lost', async () => {
    const { receiptId } = await seedIssuedReceipt(8n);

    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'lost' }, async (ctx) => {
      await ctx.tx.receipt.update({ where: { id: receiptId }, data: { lost: true } });
      await ctx.log({ subjectType: 'Receipt', subjectId: receiptId });
    });

    await expect(
      withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'un-lose' }, async (ctx) => {
        await ctx.tx.receipt.update({ where: { id: receiptId }, data: { lost: false } });
        await ctx.log({ subjectType: 'Receipt', subjectId: receiptId });
      }),
    ).rejects.toThrow(/invariant 7/);
  });

  it('delivery and deliveredAt remain freely mutable (logistics, not a receipt fact)', async () => {
    const { receiptId } = await seedIssuedReceipt(9n);

    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'mark delivered' }, async (ctx) => {
      await ctx.tx.receipt.update({
        where: { id: receiptId },
        data: { delivery: 'EMAIL', deliveredAt: new Date() },
      });
      await ctx.log({ subjectType: 'Receipt', subjectId: receiptId });
    });

    const updated = await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } });
    expect(updated.delivery).toBe('EMAIL');
    expect(updated.deliveredAt).not.toBeNull();
  });
});
