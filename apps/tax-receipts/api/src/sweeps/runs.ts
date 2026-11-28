import type { PgBoss, Db } from 'pg-boss';
import type { PrismaClient, SweepRun } from '../generated/prisma/index.js';
import {
  CONTACT_FETCH_WARNING,
  resolveSweepTarget,
  type SweepTarget,
} from '../sync/execute-target.js';
import { queueEnvironment, SWEEP_QUEUE } from './queue.js';

export function sweepRunTarget(
  run: Pick<SweepRun, 'target' | 'ridingNumber'>,
): SweepTarget {
  if (run.target === 'party') return { kind: 'party' };
  if (run.target === 'riding' && run.ridingNumber !== null)
    return { kind: 'riding', ridingNumber: run.ridingNumber };
  throw new Error('Unsupported sweep target');
}

/** Public history is application-owned, independent of pg-boss retention. */
export function sweepRunView(run: SweepRun) {
  // Older worker versions stored upstream warning text. Sanitize on every read,
  // including history predating this UI, while preserving investigative IDs.
  let result = run.result;
  if (
    result &&
    typeof result === 'object' &&
    !Array.isArray(result) &&
    Array.isArray(result.contactFetchFailures)
  ) {
    result = {
      ...result,
      contactFetchFailures: result.contactFetchFailures.map((failure) =>
        failure && typeof failure === 'object' && !Array.isArray(failure)
          ? { ...failure, message: CONTACT_FETCH_WARNING }
          : failure,
      ),
    };
  }
  return { ...run, result, target: sweepRunTarget(run) };
}

export async function queueSweep(
  prisma: PrismaClient,
  boss: PgBoss,
  userId: string,
  mode: 'incremental' | 'full',
  target: SweepTarget,
) {
  const { SWEEP_JOB_RETENTION_DAYS } = queueEnvironment();
  return prisma.$transaction(async (tx) => {
    await resolveSweepTarget(tx, target);
    const run = await tx.sweepRun.create({
      data: {
        requestedByUserId: userId,
        mode,
        target: target.kind,
        ridingNumber: target.kind === 'riding' ? target.ridingNumber : null,
      },
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
        // Only queue internals expire; application run history remains permanent.
        deleteAfterSeconds: SWEEP_JOB_RETENTION_DAYS * 86400,
        retentionSeconds: 30 * 86400,
      },
    );
    if (!jobId) throw new Error('Sweep enqueue failed');
    return sweepRunView(run);
  });
}
