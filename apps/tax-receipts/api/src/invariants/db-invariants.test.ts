import { beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import {
  issueReceipt,
  makeContribution,
  resetDb,
  seedBaseline,
  testPrisma,
} from '../test/db.js';

const prisma = testPrisma();

describe('database invariants 1-5 (ticket 0.3) reject bad writes', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
  });

  // ---- Invariant 1: allocation sum <= eligible amount ----------------------

  it('1: rejects issued allocations exceeding the eligible amount', async () => {
    const { contactId, contributionId } = await makeContribution(prisma, {
      qomonContactId: 1n,
      qomonTransactionId: 1n,
      amountCents: 10_000,
    });
    await withChangeLog(
      prisma,
      { userId: baseline.adminUserId, reason: 'non-deductible' },
      async (ctx) => {
        await ctx.tx.contributionMetadata.create({
          data: {
            contributionId,
            periodId: baseline.periodId,
            entityKind: 'PARTY',
            receivedBy: 'GPO',
            nonDeductibleCents: 4_000, // eligible = 6_000
          },
        });
        await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contributionId });
      },
    );

    await issueReceipt(prisma, {
      contactId,
      contributionId,
      periodId: baseline.periodId,
      amountCents: 6_000,
      actorUserId: baseline.cfoUserId,
    });

    await expect(
      issueReceipt(prisma, {
        contactId,
        contributionId,
        periodId: baseline.periodId,
        amountCents: 1, // 6_001 > 6_000 eligible
        actorUserId: baseline.cfoUserId,
      }),
    ).rejects.toThrow(/invariant 1/);
  });

  it('1: cancelling a receipt frees its dollars (not its number)', async () => {
    const { contactId, contributionId } = await makeContribution(prisma, {
      qomonContactId: 2n,
      qomonTransactionId: 2n,
      amountCents: 10_000,
    });
    const receiptId = await issueReceipt(prisma, {
      contactId,
      contributionId,
      periodId: baseline.periodId,
      amountCents: 10_000,
      actorUserId: baseline.cfoUserId,
    });
    // cancel, then re-allocate the full amount to a new receipt: allowed
    await withChangeLog(
      prisma,
      { userId: baseline.cfoUserId, reason: 'cancel' },
      async (ctx) => {
        await ctx.tx.receipt.update({
          where: { id: receiptId },
          data: { status: 'CANCELLED' },
        });
        await ctx.log({ subjectType: 'Receipt', subjectId: receiptId });
      },
    );
    await expect(
      issueReceipt(prisma, {
        contactId,
        contributionId,
        periodId: baseline.periodId,
        amountCents: 10_000,
        actorUserId: baseline.cfoUserId,
      }),
    ).resolves.toBeTypeOf('string');
  });

  // ---- Invariant 3: the sequence is sacred --------------------------------

  it('3: the sequence counter cannot go backward', async () => {
    await expect(
      prisma.receiptSequence.update({
        where: { prefix: 'GPO-' },
        data: { counter: 1 },
      }),
    ).rejects.toThrow(/invariant 3/);
  });

  it('3: a SEQUENCE receipt number ahead of the counter is rejected', async () => {
    const { contactId, contributionId } = await makeContribution(prisma, {
      qomonContactId: 3n,
      qomonTransactionId: 3n,
      amountCents: 5_000,
    });
    await expect(
      issueReceipt(prisma, {
        contactId,
        contributionId,
        periodId: baseline.periodId,
        amountCents: 5_000,
        actorUserId: baseline.cfoUserId,
        forceNumber: 'GPO-99999999', // counter is 402509
      }),
    ).rejects.toThrow(/invariant 3/);
  });

  it('3: a receipt number is immutable', async () => {
    const { contactId, contributionId } = await makeContribution(prisma, {
      qomonContactId: 4n,
      qomonTransactionId: 4n,
      amountCents: 5_000,
    });
    const receiptId = await issueReceipt(prisma, {
      contactId,
      contributionId,
      periodId: baseline.periodId,
      amountCents: 5_000,
      actorUserId: baseline.cfoUserId,
    });
    await expect(
      withChangeLog(
        prisma,
        { userId: baseline.cfoUserId, reason: 'tamper' },
        async (ctx) => {
          await ctx.tx.receipt.update({
            where: { id: receiptId },
            data: { receiptNumber: 'GPO-00000001' },
          });
          await ctx.log({ subjectType: 'Receipt', subjectId: receiptId });
        },
      ),
    ).rejects.toThrow(/immutable/);
  });

  it('3: FOREIGN receipt numbers are exempt from the sequence check', async () => {
    const { contactId, contributionId } = await makeContribution(prisma, {
      qomonContactId: 5n,
      qomonTransactionId: 5n,
      amountCents: 5_000,
    });
    await expect(
      issueReceipt(prisma, {
        contactId,
        contributionId,
        periodId: baseline.periodId,
        amountCents: 5_000,
        actorUserId: baseline.cfoUserId,
        forceNumber: 'EO-STOCK-000123',
        numberSource: 'FOREIGN',
      }),
    ).resolves.toBeTypeOf('string');
  });

  // ---- Invariant 4: nothing is deleted ----------------------------------

  it('4: hard-deleting a contribution / receipt / allocation / change-log row is refused', async () => {
    const { contactId, contributionId } = await makeContribution(prisma, {
      qomonContactId: 6n,
      qomonTransactionId: 6n,
      amountCents: 5_000,
    });
    const receiptId = await issueReceipt(prisma, {
      contactId,
      contributionId,
      periodId: baseline.periodId,
      amountCents: 5_000,
      actorUserId: baseline.cfoUserId,
    });

    await expect(
      prisma.$executeRaw`DELETE FROM receipt_allocation WHERE "receiptId" = ${receiptId}`,
    ).rejects.toThrow(/invariant 4/);
    await expect(
      prisma.$executeRaw`DELETE FROM receipt WHERE id = ${receiptId}`,
    ).rejects.toThrow(/invariant 4/);
    await expect(
      prisma.$executeRaw`DELETE FROM contribution WHERE id = ${contributionId}`,
    ).rejects.toThrow(/invariant 4/);
    await expect(
      prisma.$executeRaw`DELETE FROM change_log_entry`,
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.$executeRaw`UPDATE change_log_entry SET reason = 'x'`,
    ).rejects.toThrow(/append-only/);
  });

  // ---- Invariant 5: guarded mutations need a change-logged transaction ----

  it('5: a raw metadata insert with no correlation id is refused', async () => {
    const { contributionId } = await makeContribution(prisma, {
      qomonContactId: 7n,
      qomonTransactionId: 7n,
      amountCents: 5_000,
    });
    await expect(
      prisma.contributionMetadata.create({
        data: {
          contributionId,
          periodId: baseline.periodId,
          entityKind: 'PARTY',
          receivedBy: 'GPO',
        },
      }),
    ).rejects.toThrow(/invariant 5/);
  });
});
