import { QomonClient, QomonPollChangeFeed, type QomonApi } from '@gpo/qomon-client';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { partyQomonApiBase, type QomonSource } from '../qomon/settings.js';
import { runMirrorSweep } from '../sync/mirror-sweep.js';

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
    /** the party-level space; resolves to undefined while Qomon is off */
    qomon: QomonSource;
    /** builds the QomonApi for a riding's own space; defaults to a real
     *  QomonClient. Overridable so tests can inject a fake instead of
     *  hitting the network. */
    buildRidingQomon?: (riding: { qomonApiKey: string; qomonApiBase: string | null }) => QomonApi;
  },
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const buildRidingQomon =
    opts.buildRidingQomon ??
    (async (riding: { qomonApiKey: string; qomonApiBase: string | null }) =>
      new QomonClient({
        apiKey: riding.qomonApiKey,
        baseUrl: riding.qomonApiBase ?? (await partyQomonApiBase(app.prisma)),
      }));

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

      const ridingNumber = request.body?.ridingNumber;
      let qomon: QomonApi;
      let feedKind: string | undefined;

      if (ridingNumber != null) {
        const riding = await app.prisma.riding.findUnique({ where: { ridingNumber } });
        if (!riding) {
          return reply.code(404).send({ error: `no riding ${ridingNumber} on file` });
        }
        if (!riding.active) {
          return reply.code(409).send({ error: `riding ${ridingNumber} is inactive` });
        }
        qomon = await buildRidingQomon(riding);
        feedKind = `qomon-poll:riding-${ridingNumber}`;
      } else {
        const party = await opts.qomon();
        if (!party) {
          return reply
            .code(404)
            .send({ error: 'Qomon is not enabled (Admin > Qomon); cannot sweep' });
        }
        qomon = party;
      }

      const feed = new QomonPollChangeFeed(qomon, { kind: feedKind });
      const result = await runMirrorSweep(
        { prisma: app.prisma, feed, qomon },
        { mode: request.body?.mode },
      );
      return reply.send(result);
    },
  });
}
