import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { SessionUser } from '../plugins/auth.js';
import { listWorkItems } from '../work-items/list.js';
import { resolveWorkItem } from '../work-items/resolve.js';

/**
 * Work queue (ticket 1.8, screens.md 5): list + resolve/except. `WorkItem`
 * is one table for four queues (VALIDATION, DIFF, OWED_TO_EO, SYNC_INCIDENT);
 * the `kind` filter is what the screen's tabs key off.
 */
export async function workItemRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const WorkItemKind = z.enum(['VALIDATION', 'DIFF', 'OWED_TO_EO', 'SYNC_INCIDENT']);
  const WorkItemStatus = z.enum(['OPEN', 'RESOLVED', 'EXCEPTION']);

  r.route({
    method: 'GET',
    url: '/work-items',
    schema: {
      querystring: z.object({
        kind: WorkItemKind.optional(),
        status: WorkItemStatus.optional(),
        ruleRef: z.string().min(1).optional(),
        assigneeUserId: z.string().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
      }),
    },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      const q = request.query;
      const page = await listWorkItems(app.prisma, {
        filters: {
          kind: q.kind,
          status: q.status,
          ruleRef: q.ruleRef,
          assigneeUserId: q.assigneeUserId,
        },
        limit: q.limit,
        cursor: q.cursor,
      });
      return reply.send(page);
    },
  });

  r.route({
    method: 'POST',
    url: '/work-items/:id/resolve',
    schema: {
      params: z.object({ id: z.string() }),
      body: z.object({
        reason: z.string().min(3),
        outcome: z.enum(['RESOLVED', 'EXCEPTION']),
      }),
    },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('update', 'WorkItem')) {
        return reply.code(403).send({ error: 'not permitted to resolve work items' });
      }
      const updated = await resolveWorkItem(app.prisma, {
        workItemId: request.params.id,
        actorUserId: user.id,
        reason: request.body.reason,
        outcome: request.body.outcome,
      });
      return reply.send(updated);
    },
  });
}
