import { EntityKind, ReceivedBy, type GpoMetadataDescriptive } from '@gpo/tax-receipts-core';
import type { QomonApi } from '@gpo/qomon-client';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { listContributions } from '../contributions/list.js';
import { writeContributionMetadata } from '../contributions/metadata-write-through.js';
import type { SessionUser } from '../plugins/auth.js';

/**
 * Contributions list (ticket 1.3, screens.md 2) and metadata write-through
 * (ticket 1.2). The write route registers always but returns 501 until a
 * Qomon client is configured; the list route needs no such client (it only
 * reads the local mirror).
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
