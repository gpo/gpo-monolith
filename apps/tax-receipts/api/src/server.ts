import { openSweepQueue, queueEnvironment } from './sweeps/queue.js';
import { buildApp } from './app.js';
import { getPrisma } from './db.js';
import { startEmailDispatcher } from './delivery/dispatcher.js';
import { buildEmailProvider } from './delivery/provider-factory.js';
import { loadEnv } from './env.js';

/** Under Kubernetes' default 30 second termination grace period, so a stuck
 *  close still ends in a clean exit rather than a SIGKILL. */
const SHUTDOWN_TIMEOUT_MS = 25_000;

async function main(): Promise<void> {
  const env = loadEnv();
  const prisma = getPrisma();
  const queueEnv = queueEnvironment();
  const sweepQueue = await openSweepQueue(queueEnv.DATABASE_URL);
  const emailProvider = buildEmailProvider(env);
  const emailDispatch = {
    ratePerSecond: env.EMAIL_RATE_PER_SECOND,
    dailyLimit: env.EMAIL_DAILY_LIMIT ?? null,
  };
  const app = await buildApp({
    prisma,
    sweepQueue,
    ownsPrisma: true,
    sessionSecret: env.SESSION_SECRET,
    secureCookie: env.NODE_ENV === 'production',
    trustProxy: env.TRUST_PROXY,
    logger: true,
    artifactStorageDir: env.ARTIFACT_STORAGE_DIR,
    emailProvider,
    emailDispatch,
    emailLiveSendingAllowed: env.EMAIL_LIVE_SENDING_ALLOWED,
    publicWebUrl: env.PUBLIC_WEB_URL,
    gitSha: env.GIT_SHA,
  });

  app.addHook('onClose', () => sweepQueue.stop());

  const dispatcher = startEmailDispatcher(
    {
      prisma,
      storageDir: env.ARTIFACT_STORAGE_DIR,
      provider: emailProvider,
      liveSendingAllowed: env.EMAIL_LIVE_SENDING_ALLOWED,
      log: app.log,
    },
    { ...emailDispatch, intervalMs: env.EMAIL_DISPATCH_INTERVAL_MS },
  );
  app.addHook('onClose', () => dispatcher.stop());

  // Node runs as PID 1 in the container, where SIGTERM is ignored unless the
  // process handles it. Close Fastify (in-flight requests finish, then the
  // onClose hooks stop the dispatcher, the sweep queue, and Prisma) and exit.
  // A second signal, or the timeout, exits at once.
  let closing = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (closing) {
      app.log.warn({ signal }, 'second shutdown signal; exiting now');
      process.exit(1);
    }
    closing = true;
    app.log.info({ signal }, 'shutting down');
    setTimeout(() => {
      app.log.error('shutdown timed out; exiting');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
    app.close().then(
      () => {
        app.log.info('shut down cleanly');
        process.exit(0);
      },
      (err: unknown) => {
        app.log.error({ err }, 'shutdown failed');
        process.exit(1);
      },
    );
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ host: env.HOST, port: env.PORT });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
