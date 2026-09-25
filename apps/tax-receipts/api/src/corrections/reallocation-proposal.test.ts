import { beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import { createTestContribution, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { ContributionNotActiveError } from './contribution-correction.js';
import { proposeReallocation } from './reallocation-proposal.js';

const prisma = testPrisma();

describe('guided reallocation proposal (corrections action 9)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let contactId: string;
  let nextTx: bigint;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma); // PARTY limit $5,000
    await prisma.contributionLimit.create({ data: { year: 2026, bucket: 'CA', amountCents: 150_000 } });
    await prisma.riding.create({ data: { ridingNumber: 12, name: 'Brampton West', active: true, qomonApiKey: 'x' } });
    contactId = (await prisma.contact.create({ data: { qomonContactId: 1n, name: 'Dana Donor' } })).id;
    nextTx = 1n;
  });

  async function give(amountCents: number, entityKind: 'PARTY' | 'CA' = 'PARTY', ridingNumber: number | null = null) {
    const c = await createTestContribution(prisma, {
      qomonTransactionId: nextTx++,
      contactId,
      amountCents,
      acceptedAt: new Date('2026-03-01T12:00:00Z'),
    });
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contribution.update({
        where: { id: c.id },
        data: { periodId: baseline.periodId, entityKind, ridingNumber, receivedBy: 'GPO' },
      });
      await ctx.log({ subjectType: 'Contribution', subjectId: c.id, after });
    });
    return c.id;
  }

  it('proposes moving the overage to a CA the donor has not given to, and says a riding must be chosen', async () => {
    await give(400_000);
    const over = await give(200_000); // $6,000 to the party against a $5,000 limit

    const proposal = await proposeReallocation(prisma, over);

    expect(proposal.overLimitBucket).toMatchObject({ bucket: 'PARTY', limitCents: 500_000, aggregateCents: 600_000, overageCents: 100_000 });
    expect(proposal.options).toEqual([
      { entityKind: 'CA', ridingNumber: null, needsRiding: true, headroomCents: 150_000, moveCents: 100_000 },
    ]);
    expect(proposal.donorYear.map((r) => r.groupKey)).toEqual(['party']);
  });

  it('offers the remaining room in a CA the donor already gave to, and a fresh one', async () => {
    await give(400_000);
    await give(120_000, 'CA', 12);
    const over = await give(200_000);

    const proposal = await proposeReallocation(prisma, over);

    expect(proposal.options.map((o) => [o.entityKind, o.ridingNumber, o.moveCents])).toEqual([
      ['CA', null, 100_000],
      ['CA', 12, 30_000], // $1,500 limit less $1,200 already given
    ]);
  });

  it('proposes the party when a CA is what is over its limit', async () => {
    const over = await give(200_000, 'CA', 12);
    const proposal = await proposeReallocation(prisma, over);
    expect(proposal.overLimitBucket).toMatchObject({ bucket: 'CA', overageCents: 50_000 });
    expect(proposal.options[0]).toMatchObject({ entityKind: 'PARTY', ridingNumber: null, needsRiding: false, moveCents: 50_000 });
  });

  it('proposes nothing when the contribution is within its limit, and refuses a retired row', async () => {
    const fine = await give(10_000);
    const proposal = await proposeReallocation(prisma, fine);
    expect(proposal.overLimitBucket).toBeNull();
    expect(proposal.options).toEqual([]);

    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'refund' }, async (ctx) => {
      await ctx.tx.contribution.update({ where: { id: fine }, data: { status: 'REFUNDED' } });
      await ctx.log({ subjectType: 'Contribution', subjectId: fine });
    });
    await expect(proposeReallocation(prisma, fine)).rejects.toBeInstanceOf(ContributionNotActiveError);
  });
});
