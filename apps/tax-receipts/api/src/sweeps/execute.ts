import type { Prisma } from '../generated/prisma/index.js';
import {
  executeSweepTarget,
  type ExecuteSweepTargetDeps,
} from '../sync/execute-target.js';

/** One logical run; the queue consumer owns delivery and acknowledgement. */
export async function processSweepRun(
  deps: ExecuteSweepTargetDeps,
  runId: string,
) {
  const claimed = await deps.prisma.sweepRun.updateMany({
    where: { id: runId, status: 'QUEUED' },
    data: { status: 'RUNNING', startedAt: new Date() },
  });
  if (claimed.count !== 1) throw new Error('Sweep run is not queued');
  try {
    const run = await deps.prisma.sweepRun.findUniqueOrThrow({
      where: { id: runId },
    });
    if (run.mode !== 'full' && run.mode !== 'incremental')
      throw new Error('Unsupported sweep mode');
    const result = await executeSweepTarget(deps, {
      target: { kind: 'party' },
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
      },
    });
    return result;
  } catch {
    // Neither queue failure output nor application history retains an upstream error.
    await deps.prisma.sweepRun.update({
      where: { id: runId },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        error: 'Qomon sweep execution failed',
      },
    });
    throw new Error('Qomon sweep execution failed');
  }
}
