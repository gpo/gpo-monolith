import type { QomonApi } from '@gpo/qomon-client';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { BuildQomon, QomonSource } from '../qomon/settings.js';
import { executeSweepTarget, SweepTargetError } from '../sync/execute-target.js';

/**
 * Manual mirror-sweep trigger (ticket 1.1). A real cron/k8s schedule is
 * ticket 1.15 (ops monitoring); until then this is how staff or ops kick off
 * a sweep by hand. Restricted to sysadmin: it is an operational action, not a
 * data-entry one.
 *
 * Two spaces a sweep can target:
 *  - the party-level space, configured in Admin > Qomon (`opts.qomon`) —
 *    the default, and the only mode that existed before per-riding spaces;
 *  - a single riding's own space (`body.ridingNumber`), looked up in the
 *    `Riding` table and swept with that riding's own key. Each riding gets
 *    its own SyncCursor (`qomon-poll:riding-<n>`) so its resume point never
 *    collides with the party sweep's or another riding's.
 *
 * Transaction ids are assumed globally unique across every Qomon space
 * (party and every riding) — QomonTransactionLink.qomonTransactionId stays a
 * single unique column on that assumption; it is not re-scoped per space here.
 */
export async function syncRoutes(
  app: FastifyInstance,
  opts: {
    /** Optional party client override; otherwise resolve current database settings. */
    qomon?: QomonSource;
    buildQomon?: BuildQomon;
    /** builds the QomonApi for a riding's own space; defaults to a real
     *  QomonClient. Overridable so tests can inject a fake instead of
     *  hitting the network. */
    buildRidingQomon?: (riding: { qomonApiKey: string; qomonApiBase: string | null }) => QomonApi;
  },
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.route({
    method: 'POST',
    url: '/internal/sync/sweep',
    schema: {
      body: z
        .object({
          mode: z.enum(['incremental', 'full']).optional(),
          /** sweep this riding's own Qomon space instead of the party space */
          ridingNumber: z.number().int().min(1).max(124).optional(),
        })
        .nullish(),
    },
    handler: async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('manage', 'all')) {
        return reply.code(403).send({ error: 'sysadmin only' });
      }

      try {
        const result = await executeSweepTarget(
          { prisma: app.prisma, ...opts },
          {
            target: request.body?.ridingNumber == null
              ? { kind: 'party' }
              : { kind: 'riding', ridingNumber: request.body.ridingNumber },
            mode: request.body?.mode ?? 'incremental',
          },
        );
        return reply.send(result);
      } catch (error) {
        if (error instanceof SweepTargetError) {
          const partyUnavailable = request.body?.ridingNumber == null && error.code === 'MISSING_API_KEY';
          const status = error.code === 'UNKNOWN_RIDING' || error.code === 'QOMON_DISABLED' || partyUnavailable ? 404 : 409;
          return reply.code(status).send({ error: error.message });
        }
        throw error;
      }
    },
  });
}
