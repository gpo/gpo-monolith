import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { listWorkItems } from './list.js';

const prisma = testPrisma();

describe('listWorkItems (ticket 1.8)', () => {
  beforeEach(async () => {
    await resetDb(prisma);
    await seedBaseline(prisma);
  });

  async function seedItem(kind: 'VALIDATION' | 'DIFF' | 'OWED_TO_EO' | 'SYNC_INCIDENT', ruleRef?: string) {
    const contact = await prisma.contact.create({ data: { qomonContactId: BigInt(Math.floor(Math.random() * 1e9)), name: 'Dana Donor' } });
    return prisma.workItem.create({
      data: { kind, subjectType: 'Contribution', subjectId: 'c1', contactId: contact.id, ruleRef },
    });
  }

  it('filters by kind, so each tab only sees its own queue', async () => {
    await seedItem('VALIDATION', 'A8');
    await seedItem('DIFF');
    const validation = await listWorkItems(prisma, { filters: { kind: 'VALIDATION' } });
    expect(validation.data).toHaveLength(1);
    expect(validation.data[0]?.ruleRef).toBe('A8');

    const diff = await listWorkItems(prisma, { filters: { kind: 'DIFF' } });
    expect(diff.data).toHaveLength(1);
  });

  it('includes the denormalized donor name', async () => {
    await seedItem('VALIDATION', 'A2');
    const page = await listWorkItems(prisma, { filters: {} });
    expect(page.data[0]?.contactName).toBe('Dana Donor');
  });

  it('filters by status and ruleRef', async () => {
    const item = await seedItem('VALIDATION', 'A2');
    await prisma.workItem.update({ where: { id: item.id }, data: { status: 'RESOLVED', closedAt: new Date() } });
    await seedItem('VALIDATION', 'A8');

    expect((await listWorkItems(prisma, { filters: { status: 'OPEN' } })).data).toHaveLength(1);
    expect((await listWorkItems(prisma, { filters: { ruleRef: 'A2' } })).data).toHaveLength(1);
  });

  it('paginates with a cursor', async () => {
    for (let i = 0; i < 5; i += 1) await seedItem('VALIDATION', 'A8');
    const first = await listWorkItems(prisma, { filters: {}, limit: 2 });
    expect(first.data).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await listWorkItems(prisma, { filters: {}, limit: 2, cursor: first.nextCursor });
    expect(second.data.map((d) => d.id)).not.toEqual(first.data.map((d) => d.id));
  });
});
