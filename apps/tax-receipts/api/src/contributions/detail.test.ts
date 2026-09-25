import { beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import { issueReceipt, resetDb, seedBaseline, testPrisma, createTestContribution } from '../test/db.js';
import { getContributionDetail } from './detail.js';

const prisma = testPrisma();

describe('getContributionDetail (ticket 1.5)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
  });

  async function seedRow(ridingNumber: number | null = null, entityKind: 'PARTY' | 'CA' = 'PARTY') {
    const contact = await prisma.contact.create({
      data: { qomonContactId: 1n, name: 'Dana Donor', email: 'dana@example.org' },
    });
    const contribution = await createTestContribution(prisma, {
        contactId: contact.id,
        qomonTransactionId: 1n,
        qomonBundleId: 2n,
        amountCents: 5_000,
        acceptedAt: new Date('2026-03-01T00:00:00Z'),
      });
    await withChangeLog(prisma, { userId: null, reason: 'fixture' }, async (ctx) => {
      const after = await ctx.tx.contribution.update({ where: { id: contribution.id }, data: {
          periodId: baseline.periodId,
          ridingNumber,
          entityKind,
          receivedBy: 'GPO',
        } });
      await ctx.log({ subjectType: 'Contribution', subjectId: contribution.id, after });
    });
    return { contact, contribution };
  }

  it('returns null for an unknown id', async () => {
    expect(await getContributionDetail(prisma, 'nope', null)).toBeNull();
  });

  it('returns the Qomon facts, metadata, change-log slice, and work items', async () => {
    const { contribution } = await seedRow();
    await prisma.workItem.create({
      data: { kind: 'VALIDATION', subjectType: 'Contribution', subjectId: contribution.id, ruleRef: 'A8' },
    });

    const detail = await getContributionDetail(prisma, contribution.id, null);
    expect(detail?.contact.name).toBe('Dana Donor');
    expect(detail?.metadata?.periodId).toBe(baseline.periodId);
    expect(detail?.workItems).toHaveLength(1);
    expect(detail?.workItems[0]).toMatchObject({ ruleRef: 'A8', status: 'OPEN' });
    // the payment's and contribution's creation entry, then the fixture's
    // descriptive-fields edit (newest first)
    expect(detail?.changeLog.map((c) => [c.subjectType, c.reason])).toEqual(
      expect.arrayContaining([
        ['Contribution', 'fixture'],
        ['Contribution', 'test fixture'],
      ]),
    );
    expect(detail?.changeLog).toHaveLength(2);
  });

  it('includes allocations and their receipts', async () => {
    const { contact, contribution } = await seedRow();
    await issueReceipt(prisma, {
      contactId: contact.id,
      contributionId: contribution.id,
      periodId: baseline.periodId,
      amountCents: 5_000,
      actorUserId: baseline.cfoUserId,
    });
    const detail = await getContributionDetail(prisma, contribution.id, null);
    expect(detail?.allocations).toHaveLength(1);
    expect(detail?.allocations[0]?.receipt.status).toBe('ISSUED');
  });

  it('is hidden outside an out-of-grant riding, but visible for a party-level row', async () => {
    const { contribution: partyRow } = await seedRow(null, 'PARTY');
    expect(await getContributionDetail(prisma, partyRow.id, [84])).not.toBeNull();

    const contact2 = await prisma.contact.create({ data: { qomonContactId: 2n, name: 'Pat Payer' } });
    const otherRiding = await createTestContribution(prisma, { contactId: contact2.id, qomonTransactionId: 2n, amountCents: 1_000, acceptedAt: new Date('2026-03-01T00:00:00Z') });
    await withChangeLog(prisma, { userId: null, reason: 'fixture' }, async (ctx) => {
      const after = await ctx.tx.contribution.update({ where: { id: otherRiding.id }, data: { periodId: baseline.periodId, ridingNumber: 12, entityKind: 'CA', receivedBy: 'GPO' } });
      await ctx.log({ subjectType: 'Contribution', subjectId: otherRiding.id, after });
    });
    expect(await getContributionDetail(prisma, otherRiding.id, [84])).toBeNull();
  });
});
