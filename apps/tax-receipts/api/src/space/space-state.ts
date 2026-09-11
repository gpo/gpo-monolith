import {
  assertValidTransition,
  type SpaceStage as CoreSpaceStage,
  type SpaceTransitionKind,
} from '@gpo/tax-receipts-core';
import { withChangeLog } from '../changelog/write.js';
import type { EntityKind, PrismaClient, SpaceStage as PrismaSpaceStage } from '../generated/prisma/index.js';

/**
 * Persists the W6 ladder (ticket 1.9) into `SpaceState`, using the pure
 * state machine in `@gpo/tax-receipts-core`. A space is (period, riding,
 * entity kind) — derived, never stored (DESIGN.md §4) — so this only ever
 * upserts the one materialized row that key identifies
 * (`@@unique([periodId, ridingNumber, entityKind])`).
 */

const toPrismaStage = (s: CoreSpaceStage): PrismaSpaceStage =>
  s.replace(/-/g, '_') as PrismaSpaceStage;
const toCoreStage = (s: PrismaSpaceStage): CoreSpaceStage => s.replace(/_/g, '-') as CoreSpaceStage;

export interface SpaceKey {
  periodId: number;
  /** null = party-level space (data-model §2 ContributionMetadata). */
  ridingNumber: number | null;
  entityKind: EntityKind;
}

export interface SpaceStateRow {
  id: string;
  periodId: number;
  ridingNumber: number | null;
  entityKind: EntityKind;
  stage: CoreSpaceStage;
  stageOwner: string | null;
  updatedAt: Date;
}

function toRow(row: {
  id: string;
  periodId: number;
  ridingNumber: number | null;
  entityKind: EntityKind;
  stage: PrismaSpaceStage;
  stageOwner: string | null;
  updatedAt: Date;
}): SpaceStateRow {
  return { ...row, stage: toCoreStage(row.stage) };
}

/** Fetches a space's materialized state, creating it at `intake` (the
 *  ladder's start) the first time anything asks about it.
 *
 *  Not a Prisma `upsert` on the compound unique index: Prisma's generated
 *  compound-unique `where` input requires `ridingNumber: number`, not
 *  `number | null`, even though the column is nullable (party-level
 *  spaces). `findFirst` (which does accept `null` in a plain filter) plus a
 *  fallback `create` stands in instead. */
export async function getOrCreateSpaceState(
  prisma: PrismaClient,
  key: SpaceKey,
): Promise<SpaceStateRow> {
  const existing = await prisma.spaceState.findFirst({
    where: { periodId: key.periodId, ridingNumber: key.ridingNumber, entityKind: key.entityKind },
  });
  if (existing) return toRow(existing);

  const created = await prisma.spaceState.create({
    data: {
      periodId: key.periodId,
      ridingNumber: key.ridingNumber,
      entityKind: key.entityKind,
      stage: 'intake',
    },
  });
  return toRow(created);
}

export interface MoveSpaceStageInput extends SpaceKey {
  to: CoreSpaceStage;
  stageOwner?: string | null;
  /** required only for a regression (see state-machine.ts); a mandatory
   *  human reason, change-logged, since moving a space backward is unusual
   *  and audit-worthy (W7). Forward moves are routine and are not
   *  change-logged (SpaceState is not one of invariant 5's guarded tables). */
  reason?: string;
  actorUserId?: string | null;
  allowRegress?: boolean;
}

export interface MoveSpaceStageResult {
  space: SpaceStateRow;
  transition: SpaceTransitionKind;
}

export async function moveSpaceStage(
  prisma: PrismaClient,
  input: MoveSpaceStageInput,
): Promise<MoveSpaceStageResult> {
  const current = await getOrCreateSpaceState(prisma, input);
  const transition = assertValidTransition(current.stage, input.to, {
    allowRegress: input.allowRegress,
  });

  if (transition === 'noop') {
    if (input.stageOwner !== undefined && input.stageOwner !== current.stageOwner) {
      const row = await prisma.spaceState.update({
        where: { id: current.id },
        data: { stageOwner: input.stageOwner },
      });
      return { space: toRow(row), transition };
    }
    return { space: current, transition };
  }

  if (transition === 'regress') {
    if (!input.reason || input.reason.trim().length === 0) {
      throw new Error('a reason is required to move a space backward');
    }
    const space = await withChangeLog(
      prisma,
      { userId: input.actorUserId ?? null, reason: input.reason },
      async (ctx) => {
        const before = current;
        const row = await ctx.tx.spaceState.update({
          where: { id: current.id },
          data: { stage: toPrismaStage(input.to), stageOwner: input.stageOwner ?? current.stageOwner },
        });
        await ctx.log({
          subjectType: 'SpaceState',
          subjectId: current.id,
          before,
          after: toRow(row),
        });
        return toRow(row);
      },
    );
    return { space, transition };
  }

  const row = await prisma.spaceState.update({
    where: { id: current.id },
    data: { stage: toPrismaStage(input.to), stageOwner: input.stageOwner ?? current.stageOwner },
  });
  return { space: toRow(row), transition };
}
