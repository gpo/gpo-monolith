import type { PgBoss } from 'pg-boss';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  PartySweepUnavailable,
  queuePartySweep,
  sweepRunView,
} from '../sweeps/runs.js';

export async function sweepRoutes(
  app: FastifyInstance,
  opts: { queue?: PgBoss },
) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook('preHandler', async (request, reply) => {
    if (!request.user)
      return reply.code(401).send({ error: 'authentication required' });
    if (!request.ability.can('manage', 'all'))
      return reply.code(403).send({ error: 'sysadmin only' });
  });
  r.post(
    '/admin/sweeps',
    {
      schema: {
        body: z
          .object({
            target: z.object({ kind: z.literal('party') }).strict(),
            mode: z.enum(['incremental', 'full']).default('incremental'),
          })
          .strict(),
      },
    },
    async (request, reply) => {
      if (!opts.queue)
        return reply.code(503).send({ error: 'Sweep queue unavailable' });
      try {
        const run = await queuePartySweep(
          app.prisma,
          opts.queue,
          request.user!.id,
          request.body.mode,
        );
        return reply.code(202).send(run);
      } catch (error) {
        if (error instanceof PartySweepUnavailable)
          return reply.code(409).send({ error: error.message });
        // pg-boss/Prisma errors may contain SQL or connection details.
        throw new Error('Could not queue sweep');
      }
    },
  );
  r.get(
    '/admin/sweeps/:id',
    {
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (request, reply) => {
      const run = await app.prisma.sweepRun.findUnique({
        where: { id: request.params.id },
      });
      if (!run) return reply.code(404).send({ error: 'Sweep run not found' });
      return sweepRunView(run);
    },
  );
}
