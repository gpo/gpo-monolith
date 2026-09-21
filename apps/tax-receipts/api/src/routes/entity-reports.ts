import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { EntityKind, EntityReportKind } from '@gpo/tax-receipts-core';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { canSeeRiding } from '../auth/abilities.js';
import { generateAllReport } from '../reports/all-report.js';
import {
  getEntityReportDetail,
  listEntityReports,
  markEntityReportSentToCfo,
} from '../reports/entity-reports.js';
import { generateS2p2Report } from '../reports/s2p2-report.js';
import type { SessionUser } from '../plugins/auth.js';

/**
 * Entity reports screen (ticket 4.5, screens.md screen 10). Generation is
 * scoped to one entity's own file, matching the issuance wizard's pattern
 * (spaces.ts) -- the combined all-entities file EO also expects
 * (eo-reporting.md §2) stays callable only from server-side code
 * (`generateAllReport`/`generateS2p2Report` with no `entityKind`), because
 * there is no per-space label source to drive it from a single HTTP call
 * (open-questions.md O39). Nothing here regresses that: it was already true
 * before this ticket.
 */
export async function entityReportRoutes(
  app: FastifyInstance,
  opts: { storageDir: string },
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const PeriodParams = z.object({ periodId: z.coerce.number().int() });

  r.route({
    method: 'GET',
    url: '/periods/:periodId/entity-reports',
    schema: { params: PeriodParams },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });

      const all = await listEntityReports(app.prisma, request.params.periodId);
      const visible = all.filter((r) => canSeeRiding(user, r.ridingNumber));
      return reply.send({ data: visible });
    },
  });

  const GenerateEntityReportBody = z.object({
    kind: EntityReportKind,
    entityKind: EntityKind,
    ridingNumber: z.number().int().min(1).max(124).nullable(),
    politicalEntityLabel: z.string().min(1),
    reason: z.string().min(3),
  });

  r.route({
    method: 'POST',
    url: '/periods/:periodId/entity-reports',
    schema: { params: PeriodParams, body: GenerateEntityReportBody },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('create', 'EntityReport')) {
        return reply.code(403).send({ error: 'not permitted to generate entity reports' });
      }
      if (!canSeeRiding(user, request.body.ridingNumber)) {
        return reply.code(403).send({ error: 'not permitted to see this riding' });
      }

      const scope = {
        periodId: request.params.periodId,
        entityKind: request.body.entityKind,
        ridingNumber: request.body.ridingNumber,
        actorUserId: user.id,
        reason: request.body.reason,
        politicalEntityLabel: () => request.body.politicalEntityLabel,
      };

      const result =
        request.body.kind === 'ALL'
          ? await generateAllReport({ prisma: app.prisma, storageDir: opts.storageDir }, scope)
          : await generateS2p2Report({ prisma: app.prisma, storageDir: opts.storageDir }, scope);
      return reply.code(201).send(result);
    },
  });

  const EntityReportIdParams = z.object({ id: z.string() });

  r.route({
    method: 'GET',
    url: '/entity-reports/:id',
    schema: { params: EntityReportIdParams },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });

      const detail = await getEntityReportDetail(app.prisma, request.params.id);
      if (!canSeeRiding(user, detail.report.ridingNumber)) {
        return reply.code(403).send({ error: 'not permitted to see this riding' });
      }
      return reply.send(detail);
    },
  });

  r.route({
    method: 'GET',
    url: '/entity-reports/:id/csv',
    schema: { params: EntityReportIdParams },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });

      const report = await app.prisma.entityReport.findUnique({
        where: { id: request.params.id },
        include: { artifact: true },
      });
      if (!report?.artifact) return reply.code(404).send({ error: 'not found' });
      if (!canSeeRiding(user, report.ridingNumber)) {
        return reply.code(403).send({ error: 'not permitted to see this riding' });
      }

      const bytes = await readFile(path.join(opts.storageDir, report.artifact.uri));
      const filename = `${report.kind}-period${report.periodId}-${report.id}.csv`;
      return reply
        .header('content-type', 'text/csv')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .send(bytes);
    },
  });

  const SentToCfoBody = z.object({ reason: z.string().min(3) });

  r.route({
    method: 'POST',
    url: '/entity-reports/:id/sent-to-cfo',
    schema: { params: EntityReportIdParams, body: SentToCfoBody },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('share', 'EntityReport')) {
        return reply.code(403).send({ error: 'not permitted to mark reports as sent' });
      }

      const updated = await markEntityReportSentToCfo(app.prisma, request.params.id, user.id, request.body.reason);
      return reply.send(updated);
    },
  });
}
