import { beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from './write.js';
import { resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { exportChangeLogCsv, listChangeLog } from './list.js';

const prisma = testPrisma();

describe('listChangeLog / exportChangeLogCsv (ticket 1.11)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
  });

  async function seedEntry(opts: {
    actorUserId?: string | null;
    subjectId: string;
    reason: string;
    correlationId?: string;
  }) {
    await withChangeLog(
      prisma,
      { userId: opts.actorUserId ?? null, reason: opts.reason, correlationId: opts.correlationId },
      async (ctx) => {
        const item = await ctx.tx.workItem.create({
          data: { kind: 'VALIDATION', subjectType: 'Contribution', subjectId: opts.subjectId, ruleRef: 'A8' },
        });
        await ctx.log({ subjectType: 'WorkItem', subjectId: item.id, after: item });
      },
    );
  }

  it('lists entries with the actor name resolved, system actions as null', async () => {
    await seedEntry({ actorUserId: baseline.adminUserId, subjectId: 'c1', reason: 'human edit' });
    await seedEntry({ actorUserId: null, subjectId: 'c2', reason: 'system edit' });

    const page = await listChangeLog(prisma, { filters: {} });
    expect(page.data).toHaveLength(2);
    const human = page.data.find((e) => e.reason === 'human edit');
    const system = page.data.find((e) => e.reason === 'system edit');
    expect(human?.actorName).toBe('Admin');
    expect(system?.actorName).toBeNull();
  });

  it('filters by subjectType, actorUserId, and correlationId', async () => {
    await seedEntry({ actorUserId: baseline.adminUserId, subjectId: 'c1', reason: 'a', correlationId: 'corr-a' });
    await seedEntry({ actorUserId: baseline.cfoUserId, subjectId: 'c2', reason: 'b', correlationId: 'corr-b' });

    expect((await listChangeLog(prisma, { filters: { actorUserId: baseline.adminUserId } })).data).toHaveLength(1);
    expect((await listChangeLog(prisma, { filters: { correlationId: 'corr-b' } })).data).toHaveLength(1);
    expect((await listChangeLog(prisma, { filters: { subjectType: 'WorkItem' } })).data.length).toBeGreaterThanOrEqual(2);
  });

  it('filters by date range', async () => {
    await seedEntry({ actorUserId: baseline.adminUserId, subjectId: 'c1', reason: 'x' });
    const future = await listChangeLog(prisma, { filters: { dateFrom: new Date('2099-01-01T00:00:00Z') } });
    expect(future.data).toHaveLength(0);
  });

  it('exports CSV with a header row and quoted cells', async () => {
    await seedEntry({ actorUserId: baseline.adminUserId, subjectId: 'c1', reason: 'has, a comma' });
    const csv = await exportChangeLogCsv(prisma, {});
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('"at","subjectType","subjectId","actor","reason","correlationId","before","after"');
    expect(lines[1]).toContain('"has, a comma"');
    expect(lines[1]).toContain('"Admin"');
  });
});
