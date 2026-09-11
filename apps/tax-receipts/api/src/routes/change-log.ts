import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { exportChangeLogCsv, listChangeLog } from '../changelog/list.js';
import type { SessionUser } from '../plugins/auth.js';

const ChangeLogSubjectType = z.enum([
  'Contribution',
  'ContributionMetadata',
  'Contact',
  'AddressSnapshot',
  'Receipt',
  'ReceiptAllocation',
  'RtdFiling',
  'RtdInclusion',
  'EntityReport',
  'EOForm',
  'WorkItem',
  'Period',
  'ContributionLimit',
  'DonorCyclePreference',
  'SpaceState',
  'ReconciliationMark',
  'User',
  'IssuanceKillSwitch',
]);

const ChangeLogQuery = z.object({
  subjectType: ChangeLogSubjectType.optional(),
  subjectId: z.string().min(1).optional(),
  actorUserId: z.string().min(1).optional(),
  correlationId: z.string().min(1).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});

/** Change-log explorer (ticket 1.11, screens.md 12): the audit surface
 *  underpinning G4, part of the EO virtual-evaluation demo script. */
export async function changeLogRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/change-log',
    schema: { querystring: ChangeLogQuery },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      const q = request.query;
      const page = await listChangeLog(app.prisma, {
        filters: {
          subjectType: q.subjectType,
          subjectId: q.subjectId,
          actorUserId: q.actorUserId,
          correlationId: q.correlationId,
          dateFrom: q.dateFrom,
          dateTo: q.dateTo,
        },
        limit: q.limit,
        cursor: q.cursor,
      });
      return reply.send(page);
    },
  });

  r.route({
    method: 'GET',
    url: '/change-log/export',
    schema: { querystring: ChangeLogQuery.omit({ limit: true, cursor: true }) },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      const q = request.query;
      const csv = await exportChangeLogCsv(app.prisma, {
        subjectType: q.subjectType,
        subjectId: q.subjectId,
        actorUserId: q.actorUserId,
        correlationId: q.correlationId,
        dateFrom: q.dateFrom,
        dateTo: q.dateTo,
      });
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="change-log-export.csv"')
        .send(csv);
    },
  });
}
