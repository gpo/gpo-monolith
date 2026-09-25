import { beforeEach, describe, expect, it } from 'vitest';
import { makeContribution, resetDb, seedBaseline, testPrisma } from '../test/db.js';

const prisma = testPrisma();

/**
 * Database invariants for the payment/contribution split (D12, data-model
 * invariants 1 and 4): the active contributions on a payment never exceed it,
 * a correction (supersede + replace) is judged only at commit, and payments
 * and their Qomon links are never hard-deleted.
 */
describe('payment/contribution invariants (D12)', () => {
  beforeEach(async () => {
    await resetDb(prisma);
    await seedBaseline(prisma);
  });

  const acceptedAt = new Date('2026-03-01T12:00:00Z');

  it('1: accepts a split whose parts sum to the payment amount', async () => {
    const { paymentId, contributionId, contactId } = await makeContribution(prisma, {
      qomonContactId: 1n,
      qomonTransactionId: 1n,
      amountCents: 10_000,
    });
    // a couple's single cheque: halve the original, attribute the rest to a spouse
    const spouse = await prisma.contact.create({ data: { name: 'Sam Donor' } });
    await prisma.$transaction(async (tx) => {
      await tx.contribution.update({ where: { id: contributionId }, data: { amountCents: 5_000 } });
      await tx.contribution.create({
        data: { paymentId, contactId: spouse.id, amountCents: 5_000, acceptedAt },
      });
    });
    const rows = await prisma.contribution.findMany({ where: { paymentId, status: 'ACTIVE' } });
    expect(rows.map((r) => r.amountCents).sort()).toEqual([5_000, 5_000]);
    expect(rows.some((r) => r.contactId === contactId)).toBe(true);
  });

  it('1: rejects active contributions that exceed the payment amount, at commit', async () => {
    const { paymentId, contactId } = await makeContribution(prisma, {
      qomonContactId: 1n,
      qomonTransactionId: 1n,
      amountCents: 10_000,
    });
    await expect(
      prisma.contribution.create({ data: { paymentId, contactId, amountCents: 1, acceptedAt } }),
    ).rejects.toThrow(/invariant 1: payment .* exceed its amount/);
  });

  it('1: rejects shrinking the payment below what is already attributed', async () => {
    const { paymentId } = await makeContribution(prisma, {
      qomonContactId: 1n,
      qomonTransactionId: 1n,
      amountCents: 10_000,
    });
    await expect(
      prisma.payment.update({ where: { id: paymentId }, data: { amountCents: 9_999 } }),
    ).rejects.toThrow(/invariant 1: payment .* exceed its amount/);
  });

  it('1: a correction may supersede a row and open its replacement in one transaction', async () => {
    const { paymentId, contributionId, contactId } = await makeContribution(prisma, {
      qomonContactId: 1n,
      qomonTransactionId: 1n,
      amountCents: 10_000,
    });
    const other = await prisma.contact.create({ data: { name: 'Right Person' } });
    // mid-transaction the payment is over-attributed (old still ACTIVE + new);
    // the deferred trigger judges only the committed state
    const replacement = await prisma.$transaction(async (tx) => {
      const created = await tx.contribution.create({
        data: { paymentId, contactId: other.id, amountCents: 10_000, acceptedAt, supersedesId: contributionId },
      });
      await tx.contribution.update({ where: { id: contributionId }, data: { status: 'SUPERSEDED' } });
      return created;
    });
    expect(replacement.supersedesId).toBe(contributionId);
    const old = await prisma.contribution.findUniqueOrThrow({ where: { id: contributionId } });
    expect(old).toMatchObject({ status: 'SUPERSEDED', contactId });
  });

  it('1: superseded and refunded contributions do not count against the payment', async () => {
    const { paymentId, contributionId, contactId } = await makeContribution(prisma, {
      qomonContactId: 1n,
      qomonTransactionId: 1n,
      amountCents: 10_000,
    });
    await prisma.contribution.update({ where: { id: contributionId }, data: { status: 'REFUNDED' } });
    // the full amount is free again for a fresh attribution
    await expect(
      prisma.contribution.create({ data: { paymentId, contactId, amountCents: 10_000, acceptedAt } }),
    ).resolves.toBeTruthy();
  });

  it('4: never hard-deletes a payment or its Qomon link', async () => {
    const { paymentId } = await makeContribution(prisma, {
      qomonContactId: 1n,
      qomonTransactionId: 1n,
      amountCents: 10_000,
    });
    await expect(prisma.qomonTransactionLink.deleteMany({ where: { paymentId } })).rejects.toThrow(
      /invariant 4/,
    );
    await expect(prisma.payment.delete({ where: { id: paymentId } })).rejects.toThrow(/invariant 4/);
  });

  it('a manual-style payment (no Qomon link) is a first-class row with the same rules', async () => {
    const { paymentId, contactId } = await makeContribution(prisma, { amountCents: 2_500 });
    expect(await prisma.qomonTransactionLink.count()).toBe(0);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).source).toBe('MANUAL');
    await expect(
      prisma.contribution.create({ data: { paymentId, contactId, amountCents: 1, acceptedAt } }),
    ).rejects.toThrow(/invariant 1/);
  });
});
