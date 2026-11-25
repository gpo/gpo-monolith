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
      const context = {
        queue: SWEEP_QUEUE,
        jobId: job!.id,
        runId: job!.data.runId,
      };
      const startedAt = Date.now();
      console.log('Sweep job starting', context);
      try {
        const result = await processSweepRun(deps, job!.data.runId);
        console.log('Sweep job finished', {
          ...context,
          durationMs: Date.now() - startedAt,
          status: result.contactFetchFailures.length
            ? 'SUCCEEDED_WITH_WARNINGS'
            : 'SUCCEEDED',
          mode: result.mode,
          pulled: result.pulled,
          created: result.created,
          warnings: result.contactFetchFailures.length,
        });
      } catch {
        console.error('Sweep job failed', {
          ...context,
          durationMs: Date.now() - startedAt,
          status: 'FAILED',
        });
        onFailure();
        throw new Error('Qomon sweep execution failed');
      }
    },
  );
}
