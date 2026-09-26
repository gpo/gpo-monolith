import { QomonClient } from '@gpo/qomon-client';
import { buildApp } from './app.js';
import { getPrisma } from './db.js';
import { startEmailDispatcher } from './delivery/dispatcher.js';
import { buildEmailProvider } from './delivery/provider-factory.js';
import { loadEnv } from './env.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const prisma = getPrisma();
  const emailProvider = buildEmailProvider(env);
  const emailDispatch = {
    ratePerSecond: env.EMAIL_RATE_PER_SECOND,
    dailyLimit: env.EMAIL_DAILY_LIMIT ?? null,
  };
  const app = await buildApp({
    prisma,
    ownsPrisma: true,
    sessionSecret: env.SESSION_SECRET,
    secureCookie: env.NODE_ENV === 'production',
    trustProxy: env.TRUST_PROXY,
    logger: true,
    qomon: env.QOMON_API_KEY
      ? new QomonClient({ apiKey: env.QOMON_API_KEY, baseUrl: env.QOMON_API_BASE })
      : undefined,
    qomonApiBase: env.QOMON_API_BASE,
    artifactStorageDir: env.ARTIFACT_STORAGE_DIR,
    emailProvider,
    emailDispatch,
    publicWebUrl: env.PUBLIC_WEB_URL,
  });

  const dispatcher = startEmailDispatcher(
    { prisma, storageDir: env.ARTIFACT_STORAGE_DIR, provider: emailProvider, log: app.log },
    { ...emailDispatch, intervalMs: env.EMAIL_DISPATCH_INTERVAL_MS },
  );
  app.addHook('onClose', () => dispatcher.stop());

  await app.listen({ host: env.HOST, port: env.PORT });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
