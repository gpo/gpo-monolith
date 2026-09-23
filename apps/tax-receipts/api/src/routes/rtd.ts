import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { generateDc1aAmendment } from '../rtd/dc1a.js';
import { buildRtdDraft } from '../rtd/draft.js';
import { markRtdFilingSent } from '../rtd/mark-sent.js';
import { prepareRtdFiling } from '../rtd/prepare.js';
import type { SessionUser } from '../plugins/auth.js';

/**
 * RTD filings screen (ticket 2.8, screens.md screen 9, reworked for the
 * prepare/send redesign): the filing table (every `RtdFiling` with artifact
 * and send status) plus the draft builder (unreported over-threshold rows
 * with per-row business days remaining and gate-check results), the prepare
 * step (locks a selection, renders the artifact), and the send-confirmation
 * step. DC-1A generation is exposed too, decoupled from an "owed-to-EO item"
 * trigger the same way `rtd/dc1a.ts` itself is (ticket 2.4's header comment)
 * — a filer can generate one directly given a contribution id and reason.
 */
export async function rtdRoutes(app: FastifyInstance, opts: { storageDir: string }): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/rtd/filings',
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });

      const filings = await app.prisma.rtdFiling.findMany({
        include: { _count: { select: { inclusions: true } } },
        orderBy: { generatedAt: 'desc' },
      });
      return reply.send({
        data: filings.map((f) => ({
          id: f.id,
          name: f.name,
          kind: f.kind,
          format: f.format,
          generatedAt: f.generatedAt,
          submittedAt: f.submittedAt,
          submittedBy: f.submittedBy,
          artifactId: f.artifactId,
          amendsFilingId: f.amendsFilingId,
          rowCount: f._count.inclusions,
        })),
      });
    },
  });

  const FilingIdParams = z.object({ id: z.string() });

  r.route({
    method: 'GET',
    url: '/rtd/filings/:id',
    schema: { params: FilingIdParams },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });

      const filing = await app.prisma.rtdFiling.findUnique({
        where: { id: request.params.id },
        include: {
          inclusions: { include: { contribution: { include: { contact: true } } } },
          eoForms: true,
        },
      });
      if (!filing) return reply.code(404).send({ error: 'not found' });

      return reply.send({
        filing: {
          id: filing.id,
          name: filing.name,
          kind: filing.kind,
          format: filing.format,
          generatedAt: filing.generatedAt,
          submittedAt: filing.submittedAt,
          submittedBy: filing.submittedBy,
          artifactId: filing.artifactId,
          amendsFilingId: filing.amendsFilingId,
        },
        inclusions: filing.inclusions.map((i) => ({
          contributionId: i.contributionId,
          contactName: i.contribution.contact.name,
          amountCents: i.amountCents,
          aggregateAfterCents: i.aggregateAfterCents,
          acceptedAt: i.contribution.acceptedAt,
        })),
        eoForms: filing.eoForms.map((f) => ({ id: f.id, kind: f.kind, artifactId: f.artifactId })),
      });
    },
  });

  r.route({
    method: 'GET',
    url: '/rtd/filings/:id/download',
    schema: { params: FilingIdParams },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });

      const filing = await app.prisma.rtdFiling.findUnique({
        where: { id: request.params.id },
        include: { artifact: true },
      });
      if (!filing?.artifact) return reply.code(404).send({ error: 'not found' });

      const bytes = await readFile(path.join(opts.storageDir, filing.artifact.uri));
      const isPipe = filing.format === 'PIPE';
      const filename = `${filing.name}.${isPipe ? 'txt' : 'csv'}`;
      return reply
        .header('content-type', isPipe ? 'text/plain' : 'text/csv')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .send(bytes);
    },
  });

  const DraftQuery = z.object({ year: z.coerce.number().int() });

  r.route({
    method: 'GET',
    url: '/rtd/draft',
    schema: { querystring: DraftQuery },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });

      const draft = await buildRtdDraft(app.prisma, { year: request.query.year });
      return reply.send({
        year: draft.year,
        asOf: draft.asOf,
        rows: draft.rows.map((row) => ({
          contributionId: row.contributionId,
          contactId: row.contactId,
          contactFirstName: row.contactFirstName,
          contactLastName: row.contactLastName,
          amountCents: row.amountCents,
          acceptedAt: row.acceptedAt,
          contributionYear: row.contributionYear,
          aggregateAfterCents: row.aggregateAfterCents,
          periodId: row.periodId,
          eoContributorId: row.eoContributorId,
          dueDate: row.dueDate,
          businessDaysRemaining: row.businessDaysRemaining,
          overdue: row.overdue,
          gateFindings: row.gateFindings,
        })),
      });
    },
  });

  const PrepareFilingBody = z.object({
    year: z.number().int(),
    contributionIds: z.array(z.string()).min(1),
    reason: z.string().min(3),
    cfoName: z.string().min(1),
    format: z.enum(['CSV', 'PIPE']).optional(),
  });

  r.route({
    method: 'POST',
    url: '/rtd/filings',
    schema: { body: PrepareFilingBody },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('create', 'RtdFiling')) {
        return reply.code(403).send({ error: 'not permitted to prepare an RTD filing' });
      }

      const result = await prepareRtdFiling(
        { prisma: app.prisma, storageDir: opts.storageDir },
        {
          year: request.body.year,
          contributionIds: request.body.contributionIds,
          actorUserId: user.id,
          reason: request.body.reason,
          cfoName: request.body.cfoName,
          format: request.body.format,
        },
      );
      return reply.code(201).send(result);
    },
  });

  const SendFilingBody = z.object({ reason: z.string().min(3) });

  r.route({
    method: 'POST',
    url: '/rtd/filings/:id/send',
    schema: { params: FilingIdParams, body: SendFilingBody },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('file', 'RtdFiling')) {
        return reply.code(403).send({ error: 'not permitted to mark an RTD filing sent' });
      }

      const result = await markRtdFilingSent(app.prisma, {
        rtdFilingId: request.params.id,
        actorUserId: user.id,
        reason: request.body.reason,
      });
      return reply.code(201).send(result);
    },
  });

  const Dc1aParams = z.object({ contributionId: z.string() });
  const Dc1aBody = z.object({
    reason: z.string().min(3),
    workItemId: z.string().optional(),
  });

  r.route({
    method: 'POST',
    url: '/rtd/contributions/:contributionId/dc1a',
    schema: { params: Dc1aParams, body: Dc1aBody },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('file', 'EOForm')) {
        return reply.code(403).send({ error: 'not permitted to generate a DC-1A amendment' });
      }

      const result = await generateDc1aAmendment(
        { prisma: app.prisma, storageDir: opts.storageDir },
        {
          contributionId: request.params.contributionId,
          reason: request.body.reason,
          actorUserId: user.id,
          workItemId: request.body.workItemId,
        },
      );
      return reply.code(201).send(result);
    },
  });
}
