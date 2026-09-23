import { QomonError, type QomonApi } from '@gpo/qomon-client';
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
import {
  DonorPrecheckTokenExpiredError,
  DonorPrecheckTokenNotFoundError,
} from './donors/precheck.js';
import { EntityReportNotFoundError } from './reports/entity-reports.js';
import {
  AllocationContactMismatchError,
  DuplicateAllocationError,
  ReceiptNotFoundError,
  TerminalReceiptError,
} from './receipts/allocate.js';
import {
  DeliveryMissingPdfError,
  DeliveryReceiptNotFoundError,
  DeliveryReceiptNotIssuedError,
  DeliveryReceiptScopeError,
} from './receipts/delivery.js';
import {
  DuplicateForeignReceiptNumberError,
  ForeignReceiptNumberFormatError,
} from './receipts/foreign.js';
import {
  AllocationOverageError,
  MissingAddressError,
  ReceiptIssuanceValidationError,
} from './receipts/issue.js';
import {
  MissingContributionMetadataError,
  MultiAllocationReceiptError,
  ReportExportBlockedError,
  ReportScopeError,
} from './reports/load-receipts.js';
import { AmendmentWorkItemError, ContributionNotRtdReportedError } from './rtd/dc1a.js';
import {
  RtdFilingAlreadySentError,
  RtdFilingNotFoundError,
  RtdSendBlockedError,
  UnsupportedFilingKindError,
} from './rtd/mark-sent.js';
import { RtdAlreadyIncludedError, RtdExportBlockedError, RtdPrepareSelectionError } from './rtd/prepare.js';
import { SpaceIssuanceBlockedError } from './space/issuance.js';
import { WorkItemAlreadyClosedError, WorkItemNotFoundError } from './work-items/resolve.js';
import authPlugin from './plugins/auth.js';
import prismaPlugin from './plugins/prisma.js';
import { adminRoutes } from './routes/admin.js';
import { changeLogRoutes } from './routes/change-log.js';
import { contributionRoutes } from './routes/contributions.js';
import { donorPrecheckRoutes } from './routes/donor-precheck.js';
import { entityReportRoutes } from './routes/entity-reports.js';
import { healthRoutes } from './routes/health.js';
import { killSwitchRoutes } from './routes/kill-switch.js';
import { receiptRoutes } from './routes/receipts.js';
import { rtdRoutes } from './routes/rtd.js';
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
  /** the party-level Qomon space; the mirror-sweep trigger (ticket 1.1)
   *  registers regardless, but a party sweep 404s without this. */
  qomon?: QomonApi;
  /** default base URL for a riding's own Qomon space when the riding row
   *  doesn't override it (see routes/sync.ts). */
  qomonApiBase?: string;
  /** overrides how a riding's own Qomon client is built (tests only). */
  buildRidingQomon?: (riding: { qomonApiKey: string; qomonApiBase: string | null }) => QomonApi;
  /** where receipt PDF artifacts are written (ticket 3.1); see env.ts. */
  artifactStorageDir?: string;
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
      error instanceof WorkItemNotFoundError ||
      error instanceof EntityReportNotFoundError ||
      error instanceof ReceiptNotFoundError
    ) {
      return reply.code(404).send({ error: error.message });
    }
    if (
      error instanceof TerminalReceiptError ||
      error instanceof DuplicateAllocationError
    ) {
      return reply.code(409).send({ error: error.message });
    }
    if (error instanceof AllocationContactMismatchError) {
      return reply.code(400).send({ error: error.message });
    }
    if (error instanceof WorkItemAlreadyClosedError) {
      return reply.code(409).send({ error: error.message });
    }
    if (error instanceof MetadataWriteBlockedError) {
      return reply.code(409).send({ error: error.message });
    }
    if (error instanceof AllocationOverageError) {
      return reply.code(409).send({ error: error.message });
    }
    if (error instanceof ReceiptIssuanceValidationError) {
      return reply.code(400).send({ error: error.message });
    }
    if (error instanceof MissingAddressError) {
      return reply.code(422).send({ error: error.message });
    }
    if (error instanceof DuplicateForeignReceiptNumberError) {
      return reply.code(409).send({ error: error.message });
    }
    if (error instanceof ForeignReceiptNumberFormatError) {
      return reply.code(400).send({ error: error.message });
    }
    if (error instanceof DonorPrecheckTokenNotFoundError) {
      return reply.code(404).send({ error: error.message });
    }
    if (error instanceof DonorPrecheckTokenExpiredError) {
      return reply.code(410).send({ error: error.message });
    }
    if (error instanceof SpaceIssuanceBlockedError) {
      return reply.code(409).send({ error: error.message, blockers: error.blockers });
    }
    if (error instanceof DeliveryReceiptNotFoundError) {
      return reply.code(404).send({ error: error.message });
    }
    if (error instanceof DeliveryReceiptScopeError) {
      return reply.code(400).send({ error: error.message });
    }
    if (
      error instanceof DeliveryReceiptNotIssuedError ||
      error instanceof DeliveryMissingPdfError
    ) {
      return reply.code(409).send({ error: error.message });
    }
    if (error instanceof ReportExportBlockedError) {
      return reply.code(409).send({ error: error.message, findings: error.findings });
    }
    if (error instanceof RtdExportBlockedError || error instanceof RtdSendBlockedError) {
      return reply.code(409).send({ error: error.message, blocked: error.blocked });
    }
    if (
      error instanceof RtdPrepareSelectionError ||
      error instanceof RtdAlreadyIncludedError ||
      error instanceof RtdFilingNotFoundError ||
      error instanceof RtdFilingAlreadySentError ||
      error instanceof UnsupportedFilingKindError ||
      error instanceof ContributionNotRtdReportedError ||
      error instanceof AmendmentWorkItemError
    ) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    if (error instanceof ReportScopeError) {
      return reply.code(400).send({ error: error.message });
    }
    if (error instanceof MultiAllocationReceiptError || error instanceof MissingContributionMetadataError) {
      return reply.code(422).send({ error: error.message });
    }
    if (error instanceof BulkEditTooLargeError) {
      return reply.code(413).send({ error: error.message });
    }
    if (error instanceof BulkEditEmptyChangesError) {
      return reply.code(400).send({ error: error.message });
    }
    if (error instanceof QomonWriteRejectedError || error instanceof QomonWriteUnconfirmedError) {
      const cause = error.cause instanceof QomonError ? error.cause : undefined;
      request.log.error(
        {
          err: error,
          qomon: cause
            ? {
                kind: cause.name,
                message: cause.message,
                ...cause.context,
              }
            : undefined,
          unconfirmed:
            error instanceof QomonWriteUnconfirmedError ? error.diagnostics : undefined,
        },
        'Qomon metadata write-through failed',
      );
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
  await app.register(syncRoutes, {
    qomon: opts.qomon,
    qomonApiBase: opts.qomonApiBase,
    buildRidingQomon: opts.buildRidingQomon,
  });
  await app.register(contributionRoutes, { qomon: opts.qomon });
  await app.register(donorPrecheckRoutes);
  await app.register(receiptRoutes, {
    storageDir: opts.artifactStorageDir ?? './storage/artifacts',
  });
  await app.register(validationRoutes);
  await app.register(workItemRoutes);
  await app.register(spaceRoutes, {
    storageDir: opts.artifactStorageDir ?? './storage/artifacts',
  });
  await app.register(entityReportRoutes, {
    storageDir: opts.artifactStorageDir ?? './storage/artifacts',
  });
  await app.register(rtdRoutes, {
    storageDir: opts.artifactStorageDir ?? './storage/artifacts',
  });
  await app.register(changeLogRoutes);
  await app.register(adminRoutes);

  return app;
}
