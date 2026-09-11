import { beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import { issueReceipt, resetDb, seedBaseline, testPrisma } from '../test/db.js';
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
    const contribution = await prisma.contribution.create({
      data: {
        contactId: contact.id,
        qomonTransactionId: 1n,
        qomonBundleId: 2n,
        amountCents: 5_000,
        acceptedAt: new Date('2026-03-01T00:00:00Z'),
      },
    });
    await withChangeLog(prisma, { userId: null, reason: 'fixture' }, async (ctx) => {
      const after = await ctx.tx.contributionMetadata.create({
        data: {
          contributionId: contribution.id,
          periodId: baseline.periodId,
          ridingNumber,
          entityKind,
          receivedBy: 'GPO',
        },
      });
      await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contribution.id, after });
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
    expect(detail?.changeLog).toHaveLength(1); // the metadata fixture's own change-log entry
    expect(detail?.changeLog[0]?.subjectType).toBe('ContributionMetadata');
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
    const otherRiding = await prisma.contribution.create({
      data: { contactId: contact2.id, qomonTransactionId: 2n, amountCents: 1_000, acceptedAt: new Date('2026-03-01T00:00:00Z') },
    });
    await withChangeLog(prisma, { userId: null, reason: 'fixture' }, async (ctx) => {
      const after = await ctx.tx.contributionMetadata.create({
        data: { contributionId: otherRiding.id, periodId: baseline.periodId, ridingNumber: 12, entityKind: 'CA', receivedBy: 'GPO' },
      });
      await ctx.log({ subjectType: 'ContributionMetadata', subjectId: otherRiding.id, after });
    });
    expect(await getContributionDetail(prisma, otherRiding.id, [84])).toBeNull();
  });
});
