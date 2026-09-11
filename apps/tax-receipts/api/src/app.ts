import type { QomonApi } from '@gpo/qomon-client';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { PrismaClient } from './generated/prisma/index.js';
import { IssuanceDisabledError } from './auth/kill-switch.js';
import { ChangeLogError } from './changelog/write.js';
import { BulkEditEmptyChangesError, BulkEditTooLargeError } from './contributions/bulk-edit.js';
import {
  ContributionNotFoundError,
  MetadataWriteBlockedError,
  QomonWriteRejectedError,
  QomonWriteUnconfirmedError,
} from './contributions/metadata-write-through.js';
import { ContributionNotMirroredError } from './contributions/refresh.js';
import { WorkItemAlreadyClosedError, WorkItemNotFoundError } from './work-items/resolve.js';
import authPlugin from './plugins/auth.js';
import prismaPlugin from './plugins/prisma.js';
import { contributionRoutes } from './routes/contributions.js';
import { healthRoutes } from './routes/health.js';
import { killSwitchRoutes } from './routes/kill-switch.js';
import { sessionRoutes } from './routes/session.js';
import { spaceRoutes } from './routes/spaces.js';
import { syncRoutes } from './routes/sync.js';
import { validationRoutes } from './routes/validation.js';
import { workItemRoutes } from './routes/work-items.js';

export interface BuildAppOptions {
  prisma: PrismaClient;
  /** whether the app owns the client's lifecycle (disconnect on close). */
  ownsPrisma?: boolean;
  sessionSecret: string;
  secureCookie?: boolean;
  trustProxy?: boolean;
  logger?: boolean;
  /** when provided, registers the manual mirror-sweep trigger (ticket 1.1). */
  qomon?: QomonApi;
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
    if (
      error instanceof ContributionNotFoundError ||
      error instanceof ContributionNotMirroredError ||
      error instanceof WorkItemNotFoundError
    ) {
      return reply.code(404).send({ error: error.message });
    }
    if (error instanceof WorkItemAlreadyClosedError) {
      return reply.code(409).send({ error: error.message });
    }
    if (error instanceof MetadataWriteBlockedError) {
      return reply.code(409).send({ error: error.message });
    }
    if (error instanceof BulkEditTooLargeError) {
      return reply.code(413).send({ error: error.message });
    }
    if (error instanceof BulkEditEmptyChangesError) {
      return reply.code(400).send({ error: error.message });
    }
    if (error instanceof QomonWriteRejectedError || error instanceof QomonWriteUnconfirmedError) {
      return reply.code(502).send({ error: error.message });
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
  await app.register(syncRoutes, { qomon: opts.qomon });
  await app.register(contributionRoutes, { qomon: opts.qomon });
  await app.register(validationRoutes);
  await app.register(workItemRoutes);
  await app.register(spaceRoutes);

  return app;
}
