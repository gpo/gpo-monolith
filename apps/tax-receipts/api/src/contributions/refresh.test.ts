import { InMemoryQomon } from '@gpo/qomon-client/fake';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueReceipt, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { ContributionNotMirroredError, refreshContributionFromQomon } from './refresh.js';

const prisma = testPrisma();

describe('refreshContributionFromQomon (ticket 1.5 "refresh from Qomon")', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
  });

  it('throws for a contribution not in the local mirror', async () => {
    await expect(
      refreshContributionFromQomon(prisma, new InMemoryQomon(), 'nope'),
    ).rejects.toBeInstanceOf(ContributionNotMirroredError);
  });

  it('pulls the current Qomon facts and refreshes a non-receipted contribution', async () => {
    const qomon = new InMemoryQomon();
    qomon.seedContact({ id: 1, firstname: 'Dana', surname: 'Donor' });
    const bundle = qomon.seedBundle({
      transactions: [{ contact_id: 1, amount: 5_000, date: '2026-03-01T00:00:00.000Z', status_id: 1 }],
    });
    const contact = await prisma.contact.create({ data: { qomonContactId: 1n, name: 'Dana Donor' } });
    const contribution = await prisma.contribution.create({
      data: {
        contactId: contact.id,
        qomonTransactionId: BigInt(bundle.transactions[0]!.id),
        qomonBundleId: BigInt(bundle.id),
        amountCents: 5_000,
        acceptedAt: new Date('2026-03-01T00:00:00Z'),
        syncHash: 'stale',
      },
    });

    await qomon.patchTransactionBundle({
      id: bundle.id,
      transactions: [{ id: bundle.transactions[0]!.id, amount: 7_500 }],
    });

    const outcome = await refreshContributionFromQomon(prisma, qomon, contribution.id);
    expect(outcome).toBe('refreshed');
    const updated = await prisma.contribution.findUniqueOrThrow({ where: { id: contribution.id } });
    expect(updated.amountCents).toBe(7_500);
  });

  it('routes a receipted contribution into the diff queue instead of overwriting it', async () => {
    const qomon = new InMemoryQomon();
    qomon.seedContact({ id: 2, firstname: 'Pat', surname: 'Payer' });
    const bundle = qomon.seedBundle({
      transactions: [{ contact_id: 2, amount: 5_000, date: '2026-03-01T00:00:00.000Z', status_id: 1 }],
    });
    const contact = await prisma.contact.create({ data: { qomonContactId: 2n, name: 'Pat Payer' } });
    const contribution = await prisma.contribution.create({
      data: {
        contactId: contact.id,
        qomonTransactionId: BigInt(bundle.transactions[0]!.id),
        qomonBundleId: BigInt(bundle.id),
        amountCents: 5_000,
        acceptedAt: new Date('2026-03-01T00:00:00Z'),
        syncHash: 'stale',
      },
    });
    await issueReceipt(prisma, {
      contactId: contact.id,
      contributionId: contribution.id,
      periodId: baseline.periodId,
      amountCents: 5_000,
      actorUserId: baseline.cfoUserId,
    });
    await qomon.patchTransactionBundle({
      id: bundle.id,
      transactions: [{ id: bundle.transactions[0]!.id, amount: 1 }],
    });

    const outcome = await refreshContributionFromQomon(prisma, qomon, contribution.id);
    expect(outcome).toBe('diff-queued');
    const untouched = await prisma.contribution.findUniqueOrThrow({ where: { id: contribution.id } });
    expect(untouched.amountCents).toBe(5_000);
    expect(await prisma.workItem.count({ where: { kind: 'DIFF', subjectId: contribution.id } })).toBe(1);
  });

  it('is a no-op when the transaction is no longer in its bundle', async () => {
    const qomon = new InMemoryQomon();
    const bundle = qomon.seedBundle({ transactions: [] });
    const contact = await prisma.contact.create({ data: { qomonContactId: 3n, name: 'Ghost' } });
    const contribution = await prisma.contribution.create({
      data: {
        contactId: contact.id,
        qomonTransactionId: 999n,
        qomonBundleId: BigInt(bundle.id),
        amountCents: 100,
        acceptedAt: new Date('2026-03-01T00:00:00Z'),
      },
    });
    const outcome = await refreshContributionFromQomon(prisma, qomon, contribution.id);
    expect(outcome).toBe('unchanged');
  });
});
