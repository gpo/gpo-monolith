import type { PgBoss } from 'pg-boss';
import type { ExecuteSweepTargetDeps } from '../sync/execute-target.js';
import { processSweepRun } from './execute.js';
import { SWEEP_QUEUE } from './queue.js';

/** Register exactly one consumer; the singleton queue also prevents overlap across workers. */
export async function startSweepConsumer(
  queue: PgBoss,
  deps: ExecuteSweepTargetDeps,
  onFailure: () => void = () => {},
) {
  return queue.work<{ runId: string }>(
    SWEEP_QUEUE,
    { batchSize: 1, pollingIntervalSeconds: 2 },
    async ([job]) => {
      try {
        await processSweepRun(deps, job!.data.runId);
      } catch {
        onFailure();
        throw new Error('Qomon sweep execution failed');
      }
    },
  );
}
