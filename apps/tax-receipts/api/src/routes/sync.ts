import { QomonPollChangeFeed, type QomonApi } from '@gpo/qomon-client';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { runMirrorSweep } from '../sync/mirror-sweep.js';

/**
 * Manual mirror-sweep trigger (ticket 1.1). A real cron/k8s schedule is
 * ticket 1.15 (ops monitoring); until then this is how staff or ops kick off
 * a sweep by hand. Restricted to sysadmin: it is an operational action, not a
 * data-entry one, and has no per-riding scope to check.
 */
export async function syncRoutes(
  app: FastifyInstance,
  opts: { qomon?: QomonApi },
): Promise<void> {
  if (!opts.qomon) return; // not configured (no QOMON_API_KEY): route does not exist

  const qomon = opts.qomon;
  const feed = new QomonPollChangeFeed(qomon);
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'POST',
    url: '/internal/sync/sweep',
    schema: {
      body: z
        .object({ mode: z.enum(['incremental', 'full']).optional() })
        .nullish(),
    },
    handler: async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('manage', 'all')) {
        return reply.code(403).send({ error: 'sysadmin only' });
      }
      const result = await runMirrorSweep(
        { prisma: app.prisma, feed, qomon },
        { mode: request.body?.mode },
      );
      return reply.send(result);
    },
  });
}
