import { PrismaClient } from '../generated/prisma/index.js';
import { startSweepConsumer } from './consumer.js';
import { openSweepQueue, queueEnvironment, SWEEP_QUEUE } from './queue.js';

async function main() {
  console.log('Sweep worker starting', { queue: SWEEP_QUEUE, pid: process.pid });
  // Deliberately independent of the HTTP environment: no session or email settings.
  const env = queueEnvironment();
  const prisma = new PrismaClient();
  const queue = await openSweepQueue(env.DATABASE_URL, true);
  let stopping: Promise<void> | undefined;
  const stop = () =>
    (stopping ??= (async () => {
      console.log('Sweep worker stopping');
      await queue.stop({ graceful: true, timeout: 30_000 });
      await prisma.$disconnect();
      console.log('Sweep worker stopped');
    })());
  const signal = () => {
    void stop().catch(() => {
      console.error('Sweep worker shutdown failed');
      process.exitCode = 1;
    });
  };
  process.once('SIGTERM', signal);
  process.once('SIGINT', signal);
  try {
    await startSweepConsumer(queue, { prisma }, () => {
      process.exitCode = 1;
      // Let pg-boss persist its failure before closing its pool.
      setImmediate(signal);
    });
    console.log('Sweep worker ready');
  } catch {
    await stop();
    throw new Error('Sweep worker startup failed');
  }
}

main().catch(() => {
  console.error(
    'Sweep worker failed; verify database connectivity and run migrate:deploy',
  );
  process.exitCode = 1;
});
