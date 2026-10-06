import type { EntityKind } from '@gpo/tax-receipts-core';
import { withChangeLog } from '../changelog/write.js';
import type { LeadershipContestant, PrismaClient } from '../generated/prisma/index.js';

/**
 * Leadership contestants (EO evaluation row 25): the recipients a LEADERSHIP
 * contribution is directed to. A small registry managed under Admin; every
 * write is change-logged under subject type LeadershipContestant, and the
 * table is guarded in the database (invariant 5). A contestant is never
 * deleted: one who withdraws is made inactive, which stops new contributions
 * being attributed to them but leaves their history intact.
 */

export class LeadershipContestantError extends Error {
  readonly statusCode = 422;
  constructor(message: string) {
    super(message);
    this.name = 'LeadershipContestantError';
  }
}

export async function listLeadershipContestants(prisma: PrismaClient): Promise<LeadershipContestant[]> {
  return prisma.leadershipContestant.findMany({ orderBy: [{ active: 'desc' }, { contestName: 'desc' }, { name: 'asc' }] });
}

export interface LeadershipContestantFields {
  name: string;
  contestName: string;
  active?: boolean;
}

export async function createLeadershipContestant(
  prisma: PrismaClient,
  input: LeadershipContestantFields & { actorUserId: string; reason: string },
): Promise<LeadershipContestant> {
  const { actorUserId, reason, ...fields } = input;
  return withChangeLog(prisma, { userId: actorUserId, reason }, async (ctx) => {
    const created = await ctx.tx.leadershipContestant.create({ data: fields });
    await ctx.log({ subjectType: 'LeadershipContestant', subjectId: created.id, after: created });
    return created;
  });
}

export async function updateLeadershipContestant(
  prisma: PrismaClient,
  input: Partial<LeadershipContestantFields> & { id: string; actorUserId: string; reason: string },
): Promise<LeadershipContestant | null> {
  const { id, actorUserId, reason, ...fields } = input;
  const before = await prisma.leadershipContestant.findUnique({ where: { id } });
  if (!before) return null;
  return withChangeLog(prisma, { userId: actorUserId, reason }, async (ctx) => {
    const after = await ctx.tx.leadershipContestant.update({ where: { id }, data: fields });
    await ctx.log({ subjectType: 'LeadershipContestant', subjectId: id, before, after });
    return after;
  });
}

/**
 * The write-time check behind an operator attributing a contribution: a
 * LEADERSHIP contribution names an existing contestant, and no other kind
 * names one. A new attribution must be to an active contestant; `currentId`
 * is the contestant the row already has, which an edit may keep even after
 * they were made inactive. (Rule A2 makes the same shape check after the
 * fact, for rows that arrive by import.)
 */
export async function assertLeadershipAttribution(
  prisma: PrismaClient,
  entityKind: EntityKind,
  contestantId: string | null,
  currentId: string | null = null,
): Promise<void> {
  if (entityKind !== 'LEADERSHIP') {
    if (contestantId !== null) {
      throw new LeadershipContestantError(`a ${entityKind} contribution does not name a leadership contestant`);
    }
    return;
  }
  if (contestantId === null) {
    throw new LeadershipContestantError('a leadership contribution needs its leadership contestant');
  }
  const contestant = await prisma.leadershipContestant.findUnique({ where: { id: contestantId } });
  if (!contestant) throw new LeadershipContestantError(`no leadership contestant ${contestantId}`);
  if (!contestant.active && contestantId !== currentId) {
    throw new LeadershipContestantError(`${contestant.name} is no longer an active leadership contestant`);
  }
}

/**
 * The "Received By" wording printed on a receipt. For a leadership
 * contribution it is the contestant's own name from the registry, whatever
 * the operator typed: a leadership space holds every contestant's
 * contributions, so one label for the whole batch would print one
 * contestant's name on another's receipts. Every other kind keeps the
 * operator's label (that wording is still a compliance question, PHASE-3-NOTES).
 */
export async function receiptEntityLabel(
  prisma: PrismaClient,
  contribution: { entityKind: EntityKind; leadershipContestantId: string | null },
  operatorLabel: string,
): Promise<string> {
  if (contribution.entityKind !== 'LEADERSHIP' || contribution.leadershipContestantId === null) return operatorLabel;
  const contestant = await prisma.leadershipContestant.findUnique({
    where: { id: contribution.leadershipContestantId },
    select: { name: true },
  });
  return contestant?.name ?? operatorLabel;
}
