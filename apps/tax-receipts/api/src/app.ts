import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { PrismaClient } from './generated/prisma/index.js';
import { IssuanceDisabledError } from './auth/kill-switch.js';
import { ChangeLogError } from './changelog/write.js';
import authPlugin from './plugins/auth.js';
import prismaPlugin from './plugins/prisma.js';
import { healthRoutes } from './routes/health.js';
import { killSwitchRoutes } from './routes/kill-switch.js';
import { sessionRoutes } from './routes/session.js';

export interface BuildAppOptions {
  prisma: PrismaClient;
  /** whether the app owns the client's lifecycle (disconnect on close). */
  ownsPrisma?: boolean;
  sessionSecret: string;
  secureCookie?: boolean;
  trustProxy?: boolean;
  logger?: boolean;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: opts.trustProxy ?? false,
    genReqId: () => crypto.randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof IssuanceDisabledError) {
      return reply.code(423).send({ error: error.message });
    }
    if (error instanceof ChangeLogError) {
      return reply.code(400).send({ error: error.message });
    }
    if (error.validation) {
      return reply
        .code(400)
        .send({ error: 'validation failed', detail: error.message });
    }
    const status = error.statusCode ?? 500;
    if (status >= 500) request.log.error({ err: error }, 'unhandled error');
    return reply.code(status).send({
      error: status < 500 ? error.message : 'internal error',
    });
  });

  await app.register(prismaPlugin, {
    prisma: opts.prisma,
    owns: opts.ownsPrisma ?? false,
  });
  await app.register(authPlugin, {
    prisma: opts.prisma,
    sessionSecret: opts.sessionSecret,
    secureCookie: opts.secureCookie ?? false,
  });

  await app.register(healthRoutes);
  await app.register(sessionRoutes);
  await app.register(killSwitchRoutes);

  return app;
}
