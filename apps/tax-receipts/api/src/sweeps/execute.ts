import { sweepRunTarget } from './runs.js';
import type { Prisma } from '../generated/prisma/index.js';
import {
  executeSweepTarget,
  SweepExecutionError,
  type ExecuteSweepTargetDeps,
} from '../sync/execute-target.js';

/** One logical run; the queue consumer owns delivery and acknowledgement. */
export async function processSweepRun(
  deps: ExecuteSweepTargetDeps,
  runId: string,
) {
  const startedAt = new Date();
  const claimed = await deps.prisma.sweepRun.updateMany({
    where: { id: runId, status: 'QUEUED' },
    data: {
      status: 'RUNNING',
      startedAt,
      attemptCount: { increment: 1 },
    },
  });
  if (claimed.count !== 1) throw new Error('Sweep run is not queued');
  try {
    const run = await deps.prisma.sweepRun.findUniqueOrThrow({
      where: { id: runId },
    });
    if (run.mode !== 'full' && run.mode !== 'incremental')
      throw new Error('Unsupported sweep mode');
    const result = await executeSweepTarget(deps, {
      target: sweepRunTarget(run),
      mode: run.mode,
    });
    await deps.prisma.sweepRun.update({
      where: { id: runId },
      data: {
        status: result.contactFetchFailures.length
          ? 'SUCCEEDED_WITH_WARNINGS'
          : 'SUCCEEDED',
        result: result as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
      },
    });
    return result;
  } catch (error) {
    // Neither queue failure output nor application history retains an upstream error.
    await deps.prisma.sweepRun.update({
      where: { id: runId },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        error: 'Qomon sweep execution failed',
      },
    });
    throw error instanceof SweepExecutionError
      ? error
      : new SweepExecutionError(false);
  }
}
