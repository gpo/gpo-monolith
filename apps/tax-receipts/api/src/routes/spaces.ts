import { EntityKind, ReceiptDelivery } from '@gpo/tax-receipts-core';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { canSeeRiding } from '../auth/abilities.js';
import { deliverSpaceReceipts } from '../receipts/delivery.js';
import { getSpaceDashboard } from '../space/dashboard.js';
import { issueReceiptsForSpace, previewSpaceIssuance } from '../space/issuance.js';
import type { SessionUser } from '../plugins/auth.js';

/** Space dashboard (ticket 1.10, screens.md 1) plus per-space issuance
 *  (ticket 3.12, screens.md screen 6): gate check + pre-issuance preview,
 *  and generate, plus delivery (ticket 3.5): email cover letters and the
 *  consolidated print PDF. */
export async function spaceRoutes(
  app: FastifyInstance,
  opts: { storageDir: string },
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  app.get('/spaces', async (request, reply) => {
    const user = request.user as SessionUser | undefined;
    if (!user) return reply.code(401).send({ error: 'authentication required' });
    const rows = await getSpaceDashboard(app.prisma, user.allRidings ? null : user.ridingGrants);
    return reply.send({ data: rows });
  });

  const SpaceParams = z.object({
    periodId: z.coerce.number().int(),
    entityKind: EntityKind,
  });
  const SpaceQuery = z.object({
    ridingNumber: z.coerce.number().int().min(1).max(124).optional(),
  });

  r.route({
    method: 'GET',
    url: '/spaces/:periodId/:entityKind/issuance-preview',
    schema: { params: SpaceParams, querystring: SpaceQuery },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      const ridingNumber = request.query.ridingNumber ?? null;
      if (!canSeeRiding(user, ridingNumber)) {
        return reply.code(403).send({ error: 'not permitted to see this riding' });
      }

      const preview = await previewSpaceIssuance(app.prisma, {
        periodId: request.params.periodId,
        ridingNumber,
        entityKind: request.params.entityKind,
      });
      return reply.send(preview);
    },
  });

  const IssueSpaceReceiptsBody = z.object({
    reason: z.string().min(3),
    politicalEntityLabel: z.string().min(1),
    delivery: ReceiptDelivery.optional(),
  });

  r.route({
    method: 'POST',
    url: '/spaces/:periodId/:entityKind/receipts',
    schema: { params: SpaceParams, querystring: SpaceQuery, body: IssueSpaceReceiptsBody },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('issue', 'Receipt')) {
        return reply.code(403).send({ error: 'not permitted to issue receipts' });
      }
      const ridingNumber = request.query.ridingNumber ?? null;
      if (!canSeeRiding(user, ridingNumber)) {
        return reply.code(403).send({ error: 'not permitted to see this riding' });
      }

      const result = await issueReceiptsForSpace(
        { prisma: app.prisma, storageDir: opts.storageDir },
        {
          periodId: request.params.periodId,
          ridingNumber,
          entityKind: request.params.entityKind,
          actorUserId: user.id,
          reason: request.body.reason,
          politicalEntityLabel: request.body.politicalEntityLabel,
          delivery: request.body.delivery,
        },
      );
      return reply.code(201).send(result);
    },
  });

  const DeliverSpaceReceiptsBody = z.object({
    receiptIds: z.array(z.string()).min(1),
    reason: z.string().min(3),
    coverLetterBody: z.string().min(1),
  });

  r.route({
    method: 'POST',
    url: '/spaces/:periodId/:entityKind/deliver',
    schema: { params: SpaceParams, querystring: SpaceQuery, body: DeliverSpaceReceiptsBody },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('issue', 'Receipt')) {
        return reply.code(403).send({ error: 'not permitted to deliver receipts' });
      }
      const ridingNumber = request.query.ridingNumber ?? null;
      if (!canSeeRiding(user, ridingNumber)) {
        return reply.code(403).send({ error: 'not permitted to see this riding' });
      }

      const result = await deliverSpaceReceipts(
        { prisma: app.prisma, storageDir: opts.storageDir },
        {
          periodId: request.params.periodId,
          ridingNumber,
          entityKind: request.params.entityKind,
          receiptIds: request.body.receiptIds,
          actorUserId: user.id,
          reason: request.body.reason,
          coverLetterBody: request.body.coverLetterBody,
        },
      );
      return reply.code(201).send(result);
    },
  });
}
