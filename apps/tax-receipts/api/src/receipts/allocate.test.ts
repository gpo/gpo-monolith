import { describe, expect, it, beforeEach } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import { ContributionNotFoundError } from '../contributions/metadata-write-through.js';
import { issueReceipt as issueReceiptFixture, makeContribution, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import {
  AllocationContactMismatchError,
  DuplicateAllocationError,
  ReceiptNotFoundError,
  TerminalReceiptError,
  allocateToReceipt,
} from './allocate.js';
import { AllocationOverageError, ReceiptIssuanceValidationError } from './issue.js';

const prisma = testPrisma();

describe('allocateToReceipt (ticket 3.2)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
  });

  /** a second contribution under an *existing* contact — `makeContribution`
   *  always creates a fresh contact, which collides on `qomonContactId` when
   *  the point of the test is two contributions from the same donor. */
  async function seedSecondContribution(contactId: string, qomonTransactionId: bigint, amountCents: number) {
    const contribution = await prisma.contribution.create({
      data: { qomonTransactionId, contactId, amountCents, acceptedAt: new Date('2026-03-05T12:00:00Z') },
    });
    return { contactId, contributionId: contribution.id };
  }

  async function seedMetadata(contributionId: string, overrides: Record<string, unknown> = {}) {
    return withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contributionMetadata.create({
        data: { contributionId, periodId: baseline.periodId, entityKind: 'PARTY', receivedBy: 'GPO', ...overrides },
      });
      await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contributionId, after });
      return after;
    });
  }

  it('attaches a second contribution to an already-issued receipt, growing its total', async () => {
    const first = await makeContribution(prisma, { qomonContactId: 1n, qomonTransactionId: 1n, amountCents: 5_000 });
    await seedMetadata(first.contributionId);
    const receiptId = await issueReceiptFixture(prisma, {
      contactId: first.contactId,
      contributionId: first.contributionId,
      periodId: baseline.periodId,
      amountCents: 5_000,
      actorUserId: baseline.cfoUserId,
    });

    const second = await seedSecondContribution(first.contactId, 2n, 3_000);
    await seedMetadata(second.contributionId);

    const result = await allocateToReceipt(
      { prisma },
      {
        receiptId,
        contributionId: second.contributionId,
        actorUserId: baseline.cfoUserId,
        reason: 'consolidate onto one receipt',
      },
    );

    expect(result.amountCents).toBe(3_000);
    expect(result.receiptTotalCents).toBe(8_000);

    const allocations = await prisma.receiptAllocation.findMany({ where: { receiptId } });
    expect(allocations).toHaveLength(2);

    const log = await prisma.changeLogEntry.findFirst({
      where: { subjectType: 'ReceiptAllocation', subjectId: result.allocationId },
    });
    expect(log).not.toBeNull();
    expect(log!.reason).toBe('consolidate onto one receipt');
  });

  it('rejects an amount above what the contribution still has eligible (invariant 1)', async () => {
    const first = await makeContribution(prisma, { qomonContactId: 1n, qomonTransactionId: 1n, amountCents: 5_000 });
    await seedMetadata(first.contributionId);
    const receiptId = await issueReceiptFixture(prisma, {
      contactId: first.contactId,
      contributionId: first.contributionId,
      periodId: baseline.periodId,
      amountCents: 5_000,
      actorUserId: baseline.cfoUserId,
    });

    const second = await seedSecondContribution(first.contactId, 2n, 1_000);
    await seedMetadata(second.contributionId, { nonDeductibleCents: 400 });

    await expect(
      allocateToReceipt(
        { prisma },
        {
          receiptId,
          contributionId: second.contributionId,
          actorUserId: baseline.cfoUserId,
          reason: 'over-allocate',
          amountCents: 601,
        },
      ),
    ).rejects.toBeInstanceOf(AllocationOverageError);

    // exactly what remains (1_000 - 400 = 600) is fine
    const result = await allocateToReceipt(
      { prisma },
      {
        receiptId,
        contributionId: second.contributionId,
        actorUserId: baseline.cfoUserId,
        reason: 'fits exactly',
        amountCents: 600,
      },
    );
    expect(result.amountCents).toBe(600);
  });

  it('rejects a terminal (cancelled) receipt', async () => {
    const first = await makeContribution(prisma, { qomonContactId: 1n, qomonTransactionId: 1n, amountCents: 5_000 });
    await seedMetadata(first.contributionId);
    const receiptId = await issueReceiptFixture(prisma, {
      contactId: first.contactId,
      contributionId: first.contributionId,
      periodId: baseline.periodId,
      amountCents: 5_000,
      actorUserId: baseline.cfoUserId,
      status: 'CANCELLED',
    });

    const second = await seedSecondContribution(first.contactId, 2n, 1_000);
    await seedMetadata(second.contributionId);

    await expect(
      allocateToReceipt(
        { prisma },
        { receiptId, contributionId: second.contributionId, actorUserId: baseline.cfoUserId, reason: 'blocked' },
      ),
    ).rejects.toBeInstanceOf(TerminalReceiptError);
  });

  it('rejects mixing a different donor onto the receipt', async () => {
    const first = await makeContribution(prisma, { qomonContactId: 1n, qomonTransactionId: 1n, amountCents: 5_000 });
    await seedMetadata(first.contributionId);
    const receiptId = await issueReceiptFixture(prisma, {
      contactId: first.contactId,
      contributionId: first.contributionId,
      periodId: baseline.periodId,
      amountCents: 5_000,
      actorUserId: baseline.cfoUserId,
    });

    const otherDonor = await makeContribution(prisma, {
      qomonContactId: 2n,
      qomonTransactionId: 2n,
      amountCents: 1_000,
    });
    await seedMetadata(otherDonor.contributionId);

    await expect(
      allocateToReceipt(
        { prisma },
        {
          receiptId,
          contributionId: otherDonor.contributionId,
          actorUserId: baseline.cfoUserId,
          reason: 'wrong donor',
        },
      ),
    ).rejects.toBeInstanceOf(AllocationContactMismatchError);
  });

  it('rejects allocating the same contribution twice onto one receipt', async () => {
    const first = await makeContribution(prisma, { qomonContactId: 1n, qomonTransactionId: 1n, amountCents: 5_000 });
    await seedMetadata(first.contributionId);
    const receiptId = await issueReceiptFixture(prisma, {
      contactId: first.contactId,
      contributionId: first.contributionId,
      periodId: baseline.periodId,
      amountCents: 3_000,
      actorUserId: baseline.cfoUserId,
    });

    await expect(
      allocateToReceipt(
        { prisma },
        { receiptId, contributionId: first.contributionId, actorUserId: baseline.cfoUserId, reason: 'duplicate' },
      ),
    ).rejects.toBeInstanceOf(DuplicateAllocationError);
  });

  it('rejects an unknown receipt', async () => {
    const contribution = await makeContribution(prisma, { qomonContactId: 1n, qomonTransactionId: 1n, amountCents: 1_000 });
    await seedMetadata(contribution.contributionId);

    await expect(
      allocateToReceipt(
        { prisma },
        {
          receiptId: 'does-not-exist',
          contributionId: contribution.contributionId,
          actorUserId: baseline.cfoUserId,
          reason: 'missing receipt',
        },
      ),
    ).rejects.toBeInstanceOf(ReceiptNotFoundError);
  });

  it('rejects an unknown contribution', async () => {
    const first = await makeContribution(prisma, { qomonContactId: 1n, qomonTransactionId: 1n, amountCents: 5_000 });
    await seedMetadata(first.contributionId);
    const receiptId = await issueReceiptFixture(prisma, {
      contactId: first.contactId,
      contributionId: first.contributionId,
      periodId: baseline.periodId,
      amountCents: 5_000,
      actorUserId: baseline.cfoUserId,
    });

    await expect(
      allocateToReceipt(
        { prisma },
        { receiptId, contributionId: 'does-not-exist', actorUserId: baseline.cfoUserId, reason: 'missing contribution' },
      ),
    ).rejects.toBeInstanceOf(ContributionNotFoundError);
  });

  it('rejects a contribution with no metadata yet', async () => {
    const first = await makeContribution(prisma, { qomonContactId: 1n, qomonTransactionId: 1n, amountCents: 5_000 });
    await seedMetadata(first.contributionId);
    const receiptId = await issueReceiptFixture(prisma, {
      contactId: first.contactId,
      contributionId: first.contributionId,
      periodId: baseline.periodId,
      amountCents: 5_000,
      actorUserId: baseline.cfoUserId,
    });

    const second = await seedSecondContribution(first.contactId, 2n, 1_000);

    await expect(
      allocateToReceipt(
        { prisma },
        { receiptId, contributionId: second.contributionId, actorUserId: baseline.cfoUserId, reason: 'no metadata' },
      ),
    ).rejects.toBeInstanceOf(ReceiptIssuanceValidationError);
  });
});
