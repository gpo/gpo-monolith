import { QomonClient } from '@gpo/qomon-client';
import { buildApp } from './app.js';
import { getPrisma } from './db.js';
import { loadEnv } from './env.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const prisma = getPrisma();
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
  });

  await app.listen({ host: env.HOST, port: env.PORT });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
