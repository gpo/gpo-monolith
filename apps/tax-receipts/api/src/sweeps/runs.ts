import type { PgBoss, Db } from 'pg-boss';
import type { PrismaClient, SweepRun } from '../generated/prisma/index.js';
import { SWEEP_QUEUE } from './queue.js';

export class PartySweepUnavailable extends Error {
  constructor() {
    super('Qomon party space is disabled or has no API key configured');
  }
}

/** Public history is application-owned, independent of pg-boss retention. */
export function sweepRunView(run: SweepRun) {
  return {
    ...run,
    target: { kind: run.target },
  };
}

export async function queuePartySweep(
  prisma: PrismaClient,
  boss: PgBoss,
  userId: string,
  mode: 'incremental' | 'full' = 'incremental',
) {
  return prisma.$transaction(async (tx) => {
    const settings = await tx.qomonSettings.findUnique({
      where: { id: 'singleton' },
    });
    if (!settings?.enabled || !settings.apiKey.trim())
      throw new PartySweepUnavailable();
    const run = await tx.sweepRun.create({
      data: { requestedByUserId: userId, mode },
    });
    // Prisma 6 uses its native engine. Only send's parameterized SQL goes
    // through this adapter, on the exact transaction that created the run.
    const db: Db = {
      async executeSql(text, values) {
        const rows = await tx.$queryRawUnsafe<unknown[]>(
          text,
          ...(values ?? []),
        );
        return { rows };
      },
    };
    const jobId = await boss.send(
      SWEEP_QUEUE,
      { runId: run.id },
      {
        id: run.id,
        db,
        retryLimit: 0,
        // Keep finished job history indefinitely. Queued work expires separately.
        deleteAfterSeconds: 0,
        retentionSeconds: 30 * 86400,
      },
    );
    if (!jobId) throw new Error('Sweep enqueue failed');
    return sweepRunView(run);
  });
}
