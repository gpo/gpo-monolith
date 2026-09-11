import { EntityKind, ReceivedBy, type GpoMetadataDescriptive } from '@gpo/tax-receipts-core';
import type { QomonApi } from '@gpo/qomon-client';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { writeContributionMetadata } from '../contributions/metadata-write-through.js';
import type { SessionUser } from '../plugins/auth.js';

/**
 * Contribution metadata write-through (ticket 1.2). Registers always
 * (unlike the sync trigger) since editing is core path, but returns 501
 * until a Qomon client is configured (`QOMON_API_KEY`) — there is nothing
 * to write through to yet.
 *
 * Per-riding scoping (`ridingScopeWhere` / `canSeeRiding`, auth/abilities.ts)
 * is not yet applied here, consistent with the rest of Phase 0/1: no route
 * scopes by riding today. Revisit with the list/detail screens (1.3, 1.5).
 */
export async function contributionRoutes(
  app: FastifyInstance,
  opts: { qomon?: QomonApi },
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

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
