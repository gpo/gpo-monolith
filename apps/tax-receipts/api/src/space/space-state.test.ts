import { InvalidSpaceTransitionError } from '@gpo/tax-receipts-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { getOrCreateSpaceState, moveSpaceStage } from './space-state.js';

const prisma = testPrisma();

describe('space state (ticket 1.9, W6 ladder persistence)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
  });

  it('creates a space at "intake" the first time it is asked about, and is idempotent', async () => {
    const key = { periodId: baseline.periodId, ridingNumber: 84, entityKind: 'CA' as const };
    const first = await getOrCreateSpaceState(prisma, key);
    expect(first.stage).toBe('intake');
    const second = await getOrCreateSpaceState(prisma, key);
    expect(second.id).toBe(first.id);
    expect(await prisma.spaceState.count()).toBe(1);
  });

  it('creates and reuses a party-level space (ridingNumber null)', async () => {
    const key = { periodId: baseline.periodId, ridingNumber: null, entityKind: 'PARTY' as const };
    const first = await getOrCreateSpaceState(prisma, key);
    expect(first.ridingNumber).toBeNull();
    const second = await getOrCreateSpaceState(prisma, key);
    expect(second.id).toBe(first.id);
  });

  it('advances a space forward, including skipping stages, without a reason', async () => {
    const key = { periodId: baseline.periodId, ridingNumber: 84, entityKind: 'CA' as const };
    const { space, transition } = await moveSpaceStage(prisma, {
      ...key,
      to: 'reported',
      stageOwner: 'ariel',
    });
    expect(transition).toBe('advance');
    expect(space.stage).toBe('reported');
    expect(space.stageOwner).toBe('ariel');

    const row = await prisma.spaceState.findUniqueOrThrow({ where: { id: space.id } });
    expect(row.stage).toBe('reported'); // Prisma enum member, no hyphen translation needed here
  });

  it('rejects a regression without allowRegress, and without touching the row', async () => {
    const key = { periodId: baseline.periodId, ridingNumber: 84, entityKind: 'CA' as const };
    await moveSpaceStage(prisma, { ...key, to: 'issued' });

    await expect(moveSpaceStage(prisma, { ...key, to: 'reconciled' })).rejects.toBeInstanceOf(
      InvalidSpaceTransitionError,
    );
    const row = await prisma.spaceState.findFirstOrThrow({ where: { periodId: key.periodId } });
    expect(row.stage).toBe('issued');
  });

  it('requires a reason for an allowed regression and change-logs it', async () => {
    const key = { periodId: baseline.periodId, ridingNumber: 84, entityKind: 'CA' as const };
    await moveSpaceStage(prisma, { ...key, to: 'issued' });

    await expect(
      moveSpaceStage(prisma, { ...key, to: 'reconciled', allowRegress: true }),
    ).rejects.toThrow(/reason/);

    const { space, transition } = await moveSpaceStage(prisma, {
      ...key,
      to: 'reconciled',
      allowRegress: true,
      reason: 'diff queue reopened this space',
      actorUserId: baseline.adminUserId,
    });
    expect(transition).toBe('regress');
    expect(space.stage).toBe('reconciled');

    const entries = await prisma.changeLogEntry.findMany({ where: { subjectType: 'SpaceState' } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ reason: 'diff queue reopened this space', actorUserId: baseline.adminUserId });
  });

  it('a same-stage move is a no-op but can still update the stage owner', async () => {
    const key = { periodId: baseline.periodId, ridingNumber: 84, entityKind: 'CA' as const };
    await moveSpaceStage(prisma, { ...key, to: 'queue-clear', stageOwner: 'matt' });
    const { space, transition } = await moveSpaceStage(prisma, {
      ...key,
      to: 'queue-clear',
      stageOwner: 'stephanie',
    });
    expect(transition).toBe('noop');
    expect(space.stageOwner).toBe('stephanie');
    expect(await prisma.changeLogEntry.count()).toBe(0);
  });
});
