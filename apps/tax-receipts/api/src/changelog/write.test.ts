import { beforeEach, describe, expect, it } from 'vitest';
import { ChangeLogError, withChangeLog } from './write.js';
import {
  makeContribution,
  resetDb,
  seedBaseline,
  testPrisma,
} from '../test/db.js';

const prisma = testPrisma();

describe('withChangeLog (ticket 0.4 / G4)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
  });

  it('writes the ChangeLogEntry in the same transaction as the mutation', async () => {
    const { contributionId } = await makeContribution(prisma, {
      qomonContactId: 1n,
      qomonTransactionId: 1n,
      amountCents: 10_000,
    });

    await withChangeLog(
      prisma,
      { userId: baseline.adminUserId, reason: 'set intake defaults' },
      async (ctx) => {
        await ctx.tx.contributionMetadata.create({
          data: {
            contributionId,
            periodId: baseline.periodId,
            entityKind: 'PARTY',
            receivedBy: 'GPO',
          },
        });
        await ctx.log({
          subjectType: 'ContributionMetadata',
          subjectId: contributionId,
          after: { entityKind: 'PARTY' },
        });
      },
    );

    const entries = await prisma.changeLogEntry.findMany();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      subjectType: 'ContributionMetadata',
      actorUserId: baseline.adminUserId,
      reason: 'set intake defaults',
    });
  });

  it('rejects a blank reason before opening a transaction', async () => {
    await expect(
      withChangeLog(prisma, { userId: null, reason: '  ' }, async () => {}),
    ).rejects.toBeInstanceOf(ChangeLogError);
  });

  it('rolls the whole transaction back when the block throws', async () => {
    const { contributionId } = await makeContribution(prisma, {
      qomonContactId: 2n,
      qomonTransactionId: 2n,
      amountCents: 10_000,
    });
    await expect(
      withChangeLog(
        prisma,
        { userId: baseline.adminUserId, reason: 'partial edit' },
        async (ctx) => {
          await ctx.tx.contributionMetadata.create({
            data: {
              contributionId,
              periodId: baseline.periodId,
              entityKind: 'PARTY',
              receivedBy: 'GPO',
            },
          });
          await ctx.log({
            subjectType: 'ContributionMetadata',
            subjectId: contributionId,
          });
          throw new Error('boom');
        },
      ),
    ).rejects.toThrow('boom');

    expect(await prisma.contributionMetadata.count()).toBe(0);
    expect(await prisma.changeLogEntry.count()).toBe(0);
  });

  it('the DB aborts a guarded mutation that records no ChangeLogEntry', async () => {
    const { contributionId } = await makeContribution(prisma, {
      qomonContactId: 3n,
      qomonTransactionId: 3n,
      amountCents: 10_000,
    });
    // withChangeLog itself throws when no entry is logged; assert the DB
    // constraint is the real backstop by calling the transaction directly.
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.correlation_id', 'orphan-cid', true)`;
        await tx.contributionMetadata.create({
          data: {
            contributionId,
            periodId: baseline.periodId,
            entityKind: 'PARTY',
            receivedBy: 'GPO',
          },
        });
      }),
    ).rejects.toThrow(/invariant 5/);
    expect(await prisma.contributionMetadata.count()).toBe(0);
  });

  it('shares one correlationId across a multi-row cascade', async () => {
    const a = await makeContribution(prisma, {
      qomonContactId: 10n,
      qomonTransactionId: 10n,
      amountCents: 5_000,
    });
    const b = await makeContribution(prisma, {
      qomonContactId: 11n,
      qomonTransactionId: 11n,
      amountCents: 5_000,
    });
    await withChangeLog(
      prisma,
      { userId: baseline.adminUserId, reason: 'bulk period reassignment' },
      async (ctx) => {
        for (const c of [a, b]) {
          await ctx.tx.contributionMetadata.create({
            data: {
              contributionId: c.contributionId,
              periodId: baseline.periodId,
              entityKind: 'PARTY',
              receivedBy: 'GPO',
            },
          });
          await ctx.log({
            subjectType: 'ContributionMetadata',
            subjectId: c.contributionId,
          });
        }
      },
    );
    const entries = await prisma.changeLogEntry.findMany();
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((e) => e.correlationId)).size).toBe(1);
  });
});
