import { PrismaClient } from '../generated/prisma/index.js';
import { startSweepConsumer } from './consumer.js';
import { openSweepQueue, queueEnvironment } from './queue.js';

async function main() {
  // Deliberately independent of the HTTP environment: no session or email settings.
  const env = queueEnvironment();
  const prisma = new PrismaClient();
  const queue = await openSweepQueue(env.DATABASE_URL, true);
  let stopping: Promise<void> | undefined;
  const stop = () =>
    (stopping ??= (async () => {
      await queue.stop({ graceful: true, timeout: 30_000 });
      await prisma.$disconnect();
    })());
  const signal = () => {
    void stop().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once('SIGTERM', signal);
  process.once('SIGINT', signal);
  try {
    await startSweepConsumer(queue, { prisma }, () => {
      process.exitCode = 1;
      console.error('Qomon sweep execution failed');
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
