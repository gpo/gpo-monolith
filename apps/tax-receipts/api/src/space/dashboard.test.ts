import { beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import { resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { getSpaceDashboard } from './dashboard.js';
import { moveSpaceStage } from './space-state.js';

const prisma = testPrisma();

describe('getSpaceDashboard (ticket 1.10)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
  });

  async function seedContribution(ridingNumber: number | null, entityKind: 'PARTY' | 'CA', qomonId: bigint) {
    const contact = await prisma.contact.create({ data: { qomonContactId: qomonId, name: 'Dana Donor' } });
    const contribution = await prisma.contribution.create({
      data: { contactId: contact.id, qomonTransactionId: qomonId, amountCents: 1_000, acceptedAt: new Date('2026-03-01T00:00:00Z') },
    });
    await withChangeLog(prisma, { userId: null, reason: 'fixture' }, async (ctx) => {
      const after = await ctx.tx.contributionMetadata.create({
        data: { contributionId: contribution.id, periodId: baseline.periodId, ridingNumber, entityKind, receivedBy: 'GPO' },
      });
      await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contribution.id, after });
    });
    return contribution;
  }

  it('derives spaces from ContributionMetadata, defaulting stage to intake', async () => {
    await seedContribution(84, 'CA', 1n);
    await seedContribution(null, 'PARTY', 2n);

    const rows = await getSpaceDashboard(prisma, null);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.stage === 'intake')).toBe(true);
    const ca = rows.find((r) => r.ridingNumber === 84);
    expect(ca?.contributionCount).toBe(1);
  });

  it('reads the real stage and owner once a SpaceState row exists', async () => {
    await seedContribution(84, 'CA', 3n);
    await moveSpaceStage(prisma, {
      periodId: baseline.periodId,
      ridingNumber: 84,
      entityKind: 'CA',
      to: 'reconciled',
      stageOwner: 'ariel',
    });

    const rows = await getSpaceDashboard(prisma, null);
    const ca = rows.find((r) => r.ridingNumber === 84);
    expect(ca).toMatchObject({ stage: 'reconciled', stageOwner: 'ariel' });
  });

  it('counts open work items per space', async () => {
    const c = await seedContribution(84, 'CA', 4n);
    await prisma.workItem.create({
      data: { kind: 'VALIDATION', subjectType: 'Contribution', subjectId: c.id, ruleRef: 'A8' },
    });
    const rows = await getSpaceDashboard(prisma, null);
    expect(rows.find((r) => r.ridingNumber === 84)?.openWorkItemCount).toBe(1);
  });

  it('applies riding scope, always keeping party-level spaces', async () => {
    await seedContribution(84, 'CA', 5n);
    await seedContribution(12, 'CA', 6n);
    await seedContribution(null, 'PARTY', 7n);

    const rows = await getSpaceDashboard(prisma, [84]);
    expect(new Set(rows.map((r) => r.ridingNumber))).toEqual(new Set([null, 84]));
  });
});
