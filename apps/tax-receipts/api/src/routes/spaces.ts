import { EntityKind, ReceiptDelivery } from '@gpo/tax-receipts-core';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { canSeeRiding } from '../auth/abilities.js';
import { sendDonorPrechecksForSpace } from '../donors/precheck.js';
import { getSpaceDashboard } from '../space/dashboard.js';
import { issueReceiptsForSpace, previewSpaceIssuance } from '../space/issuance.js';
import type { SessionUser } from '../plugins/auth.js';

/** Space dashboard (ticket 1.10, screens.md 1) plus per-space issuance
 *  (ticket 3.12, screens.md screen 6): gate check + pre-issuance preview,
 *  generate, and the donor pre-check send. Delivery lives in
 *  routes/delivery.ts (ticket 3.6). */
export async function spaceRoutes(
  app: FastifyInstance,
  opts: { storageDir: string; publicWebUrl: string },
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

  const SendPrechecksBody = z.object({
    reason: z.string().min(3),
    expiresInDays: z.number().int().positive().optional(),
    /** both or neither: with them, each donor's link is emailed (ticket 3.6) */
    emailSubject: z.string().min(1).max(200).optional(),
    emailBody: z.string().min(1).optional(),
  }).refine((b) => (b.emailSubject === undefined) === (b.emailBody === undefined), {
    message: 'emailSubject and emailBody go together',
  });

  r.route({
    method: 'POST',
    url: '/spaces/:periodId/:entityKind/precheck',
    schema: { params: SpaceParams, querystring: SpaceQuery, body: SendPrechecksBody },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('update', 'ContributionMetadata')) {
        return reply.code(403).send({ error: 'not permitted to run the donor pre-check' });
      }
      const ridingNumber = request.query.ridingNumber ?? null;
      if (!canSeeRiding(user, ridingNumber)) {
        return reply.code(403).send({ error: 'not permitted to see this riding' });
      }

      const result = await sendDonorPrechecksForSpace(app.prisma, {
        periodId: request.params.periodId,
        ridingNumber,
        entityKind: request.params.entityKind,
        actorUserId: user.id,
        reason: request.body.reason,
        expiresInDays: request.body.expiresInDays,
        ...(request.body.emailSubject && request.body.emailBody
          ? {
              email: {
                subject: request.body.emailSubject,
                body: request.body.emailBody,
                confirmUrlBase: opts.publicWebUrl,
              },
            }
          : {}),
      });
      return reply.code(201).send(result);
    },
  });
}
