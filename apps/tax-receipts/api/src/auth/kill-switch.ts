import type { PrismaClient } from '../generated/prisma/index.js';
import { withChangeLog, type ActorContext } from '../changelog/write.js';

/**
 * The statutory issuance kill switch (EFA s. 25.1(7), ticket 0.5). The party
 * CFO must be able to immediately cease issuing on the CEO of Elections
 * Ontario's request. `assertIssuanceEnabled` is called at EVERY issuance path
 * (issuance wizard, reissue, correction cascades) in later phases.
 */

const SINGLETON_ID = 'singleton';

export class IssuanceDisabledError extends Error {
  readonly statusCode = 423; // Locked
  constructor(reason: string | null) {
    super(
      `receipt issuance is currently disabled by the kill switch${
        reason ? `: ${reason}` : ''
      }`,
    );
    this.name = 'IssuanceDisabledError';
  }
}

export interface KillSwitchState {
  engaged: boolean;
  engagedAt: Date | null;
  engagedBy: string | null;
  reason: string | null;
}

export async function getKillSwitch(
  prisma: PrismaClient,
): Promise<KillSwitchState> {
  const row = await prisma.issuanceKillSwitch.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID },
    update: {},
  });
  return {
    engaged: row.engaged,
    engagedAt: row.engagedAt,
    engagedBy: row.engagedBy,
    reason: row.reason,
  };
}

export async function assertIssuanceEnabled(
  prisma: PrismaClient,
): Promise<void> {
  const state = await getKillSwitch(prisma);
  if (state.engaged) throw new IssuanceDisabledError(state.reason);
}

export async function setKillSwitch(
  prisma: PrismaClient,
  actor: ActorContext,
  engaged: boolean,
): Promise<KillSwitchState> {
  const before = await getKillSwitch(prisma);
  return withChangeLog(prisma, actor, async (ctx) => {
    const row = await ctx.tx.issuanceKillSwitch.upsert({
      where: { id: SINGLETON_ID },
      create: {
        id: SINGLETON_ID,
        engaged,
        engagedAt: engaged ? new Date() : null,
        engagedBy: engaged ? actor.userId : null,
        reason: actor.reason,
      },
      update: {
        engaged,
        engagedAt: engaged ? new Date() : null,
        engagedBy: engaged ? actor.userId : null,
        reason: actor.reason,
      },
    });
    await ctx.log({
      subjectType: 'IssuanceKillSwitch',
      subjectId: SINGLETON_ID,
      before,
      after: {
        engaged: row.engaged,
        engagedAt: row.engagedAt,
        engagedBy: row.engagedBy,
        reason: row.reason,
      },
    });
    return {
      engaged: row.engaged,
      engagedAt: row.engagedAt,
      engagedBy: row.engagedBy,
      reason: row.reason,
    };
  });
}
