import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb, seedBaseline, testPrisma } from '../test/db.js';
import {
  editException,
  resolveWorkItem,
  WorkItemAlreadyClosedError,
  WorkItemNotExceptionError,
  WorkItemNotFoundError,
} from './resolve.js';

const prisma = testPrisma();

describe('resolveWorkItem (ticket 1.7 resolution actions)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
  });

  it('resolves an open work item and change-logs it', async () => {
    const item = await prisma.workItem.create({
      data: { kind: 'VALIDATION', subjectType: 'Contribution', subjectId: 'c1', ruleRef: 'A8' },
    });
    const updated = await resolveWorkItem(prisma, {
      workItemId: item.id,
      actorUserId: baseline.adminUserId,
      reason: 'fixed the payment method',
      outcome: 'RESOLVED',
    });
    expect(updated.status).toBe('RESOLVED');
    expect(updated.closedAt).not.toBeNull();
    const entries = await prisma.changeLogEntry.findMany({ where: { subjectType: 'WorkItem' } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ reason: 'fixed the payment method', actorUserId: baseline.adminUserId });
  });

  it('excepts an open work item with a reason', async () => {
    const item = await prisma.workItem.create({
      data: { kind: 'VALIDATION', subjectType: 'Contribution', subjectId: 'c1', ruleRef: 'B2' },
    });
    const updated = await resolveWorkItem(prisma, {
      workItemId: item.id,
      actorUserId: baseline.adminUserId,
      reason: 'candidate-self limit applies',
      outcome: 'EXCEPTION',
    });
    expect(updated.status).toBe('EXCEPTION');
  });

  it('rejects resolving an already-closed item', async () => {
    const item = await prisma.workItem.create({
      data: { kind: 'VALIDATION', subjectType: 'Contribution', subjectId: 'c1', ruleRef: 'A8', status: 'RESOLVED', closedAt: new Date() },
    });
    await expect(
      resolveWorkItem(prisma, { workItemId: item.id, actorUserId: baseline.adminUserId, reason: 'x', outcome: 'RESOLVED' }),
    ).rejects.toBeInstanceOf(WorkItemAlreadyClosedError);
  });

  it('throws for an unknown work item', async () => {
    await expect(
      resolveWorkItem(prisma, { workItemId: 'nope', actorUserId: baseline.adminUserId, reason: 'x', outcome: 'RESOLVED' }),
    ).rejects.toBeInstanceOf(WorkItemNotFoundError);
  });

  it('edits an exception reason without moving its closedAt, and change-logs it', async () => {
    const closedAt = new Date('2026-02-01T12:00:00.000Z');
    const item = await prisma.workItem.create({
      data: {
        kind: 'VALIDATION',
        subjectType: 'Contribution',
        subjectId: 'c1',
        ruleRef: 'B1',
        status: 'EXCEPTION',
        resolutionNote: 'student',
        closedAt,
      },
    });
    const updated = await editException(prisma, {
      workItemId: item.id,
      actorUserId: baseline.adminUserId,
      exceptionReason: 'Ontario resident studying at UBC; home address in Ottawa confirmed by phone',
      reason: 'added how residency was confirmed',
    });
    expect(updated.status).toBe('EXCEPTION');
    expect(updated.resolutionNote).toBe('Ontario resident studying at UBC; home address in Ottawa confirmed by phone');
    expect(updated.closedAt).toEqual(closedAt);
    const entries = await prisma.changeLogEntry.findMany({ where: { subjectType: 'WorkItem' } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ reason: 'added how residency was confirmed', actorUserId: baseline.adminUserId });
  });

  it('rejects editing the reason of an item that is not an exception', async () => {
    const item = await prisma.workItem.create({
      data: { kind: 'VALIDATION', subjectType: 'Contribution', subjectId: 'c1', ruleRef: 'A8', status: 'RESOLVED', closedAt: new Date() },
    });
    await expect(
      editException(prisma, { workItemId: item.id, actorUserId: baseline.adminUserId, exceptionReason: 'abc', reason: 'abc' }),
    ).rejects.toBeInstanceOf(WorkItemNotExceptionError);
  });
});
