import { EntityKind, ReceivedBy, type GpoMetadataDescriptive } from '@gpo/tax-receipts-core';
import type { QomonApi } from '@gpo/qomon-client';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { BULK_EDIT_MAX_ROWS, bulkEditContributionMetadata } from '../contributions/bulk-edit.js';
import { getContributionDetail } from '../contributions/detail.js';
import { listContributions } from '../contributions/list.js';
import { writeContributionMetadata } from '../contributions/metadata-write-through.js';
import { refreshContributionFromQomon } from '../contributions/refresh.js';
import type { SessionUser } from '../plugins/auth.js';

/**
 * Contributions list (ticket 1.3, screens.md 2), detail (ticket 1.5,
 * screens.md 3), metadata write-through (ticket 1.2), and bulk edit
 * (ticket 1.4). The write, bulk-edit, and refresh routes register always
 * but return 501 until a Qomon client is configured; the read routes need
 * no such client (they only read the local mirror).
 */
export async function contributionRoutes(
  app: FastifyInstance,
  opts: { qomon?: QomonApi },
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const ContributionListQuery = z.object({
    periodId: z.coerce.number().int().optional(),
    ridingNumber: z.coerce.number().int().min(1).max(124).optional(),
    partyLevelOnly: z.enum(['true', 'false']).optional(),
    entityKind: EntityKind.optional(),
    receivedBy: ReceivedBy.optional(),
    contactQuery: z.string().min(1).optional(),
    minAmountCents: z.coerce.number().int().optional(),
    maxAmountCents: z.coerce.number().int().optional(),
    acceptedFrom: z.coerce.date().optional(),
    acceptedTo: z.coerce.date().optional(),
    hasOpenValidation: z.enum(['true', 'false']).optional(),
    ruleRef: z.string().min(1).optional(),
    hasReceipt: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    cursor: z.string().optional(),
  });

  r.route({
    method: 'GET',
    url: '/contributions',
    schema: { querystring: ContributionListQuery },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });

      const q = request.query;
      const page = await listContributions(app.prisma, {
        filters: {
          periodId: q.periodId,
          ridingNumber: q.partyLevelOnly === 'true' ? null : q.ridingNumber,
          entityKind: q.entityKind,
          receivedBy: q.receivedBy,
          contactQuery: q.contactQuery,
          minAmountCents: q.minAmountCents,
          maxAmountCents: q.maxAmountCents,
          acceptedFrom: q.acceptedFrom,
          acceptedTo: q.acceptedTo,
          hasOpenValidation: q.hasOpenValidation ? q.hasOpenValidation === 'true' : undefined,
          ruleRef: q.ruleRef,
          hasReceipt: q.hasReceipt ? q.hasReceipt === 'true' : undefined,
        },
        limit: q.limit,
        cursor: q.cursor,
        ridingScope: user.allRidings ? null : user.ridingGrants,
      });
      return reply.send(page);
    },
  });

  r.route({
    method: 'GET',
    url: '/contributions/:id',
    schema: { params: z.object({ id: z.string() }) },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });

      const detail = await getContributionDetail(
        app.prisma,
        request.params.id,
        user.allRidings ? null : user.ridingGrants,
      );
      if (!detail) return reply.code(404).send({ error: 'not found' });
      return reply.send(detail);
    },
  });

  r.route({
    method: 'POST',
    url: '/contributions/:id/refresh',
    schema: { params: z.object({ id: z.string() }) },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!opts.qomon) {
        return reply
          .code(501)
          .send({ error: 'Qomon is not configured (QOMON_API_KEY unset); cannot refresh' });
      }
      const outcome = await refreshContributionFromQomon(app.prisma, opts.qomon, request.params.id);
      return reply.send({ outcome });
    },
  });

  const BulkEditBody = z.object({
    reason: z.string().min(3),
    contributionIds: z.array(z.string()).min(1).max(BULK_EDIT_MAX_ROWS),
    changes: z
      .object({
        periodId: z.number().int().optional(),
        ridingNumber: z.number().int().min(1).max(124).nullable().optional(),
        entityKind: EntityKind.optional(),
        receivedBy: ReceivedBy.optional(),
        goodsServices: z.boolean().optional(),
        nonDeductibleCents: z.number().int().min(0).optional(),
        processedDate: z.string().date().nullable().optional(),
        sourceCode: z.string().optional(),
        eoContributorId: z.string().nullable().optional(),
        exceptionReason: z.string().nullable().optional(),
        externalRef: z.string().nullable().optional(),
      })
      .partial(),
  });

  r.route({
    method: 'POST',
    url: '/contributions/bulk-edit',
    schema: { body: BulkEditBody },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('update', 'ContributionMetadata')) {
        return reply.code(403).send({ error: 'not permitted to edit contribution metadata' });
      }
      if (!opts.qomon) {
        return reply
          .code(501)
          .send({ error: 'Qomon is not configured (QOMON_API_KEY unset); cannot write through' });
      }
      const result = await bulkEditContributionMetadata(
        { prisma: app.prisma, qomon: opts.qomon },
        {
          contributionIds: request.body.contributionIds,
          actorUserId: user.id,
          reason: request.body.reason,
          changes: request.body.changes,
        },
      );
      return reply.send(result);
    },
  });

  const MetadataEditBody = z.object({
    reason: z.string().min(3),
    periodId: z.number().int(),
    ridingNumber: z.number().int().min(1).max(124).nullable(),
    entityKind: EntityKind,
    receivedBy: ReceivedBy,
    goodsServices: z.boolean(),
    nonDeductibleCents: z.number().int().min(0),
    processedDate: z.string().date().nullable(),
    sourceCode: z.string(),
    eoContributorId: z.string().nullable(),
    exceptionReason: z.string().nullable(),
    externalRef: z.string().nullable(),
  });

  r.route({
    method: 'PATCH',
    url: '/contributions/:id/metadata',
    schema: {
      params: z.object({ id: z.string() }),
      body: MetadataEditBody,
    },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('update', 'ContributionMetadata')) {
        return reply.code(403).send({ error: 'not permitted to edit contribution metadata' });
      }
      if (!opts.qomon) {
        return reply
          .code(501)
          .send({ error: 'Qomon is not configured (QOMON_API_KEY unset); cannot write through' });
      }

      const { reason, ...d } = request.body;
      const descriptive: GpoMetadataDescriptive = {
        period_id: d.periodId,
        riding_number: d.ridingNumber,
        entity_kind: d.entityKind,
        received_by: d.receivedBy,
        goods_services: d.goodsServices,
        non_deductible_cents: d.nonDeductibleCents,
        processed_date: d.processedDate,
        source_code: d.sourceCode,
        eo_contributor_id: d.eoContributorId,
        exception_reason: d.exceptionReason,
        external_ref: d.externalRef,
      };

      const updated = await writeContributionMetadata(
        { prisma: app.prisma, qomon: opts.qomon },
        {
          contributionId: request.params.id,
          actorUserId: user.id,
          reason,
          descriptive,
        },
      );
      return reply.send(updated);
    },
  });
}
