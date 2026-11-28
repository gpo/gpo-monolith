import type { PgBoss } from 'pg-boss';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SweepTargetError } from '../sync/execute-target.js';
import { queueSweep, sweepRunView } from '../sweeps/runs.js';

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
            target: z.discriminatedUnion('kind', [
              z.object({ kind: z.literal('party') }).strict(),
              z
                .object({
                  kind: z.literal('riding'),
                  ridingNumber: z.number().int().positive().max(2147483647),
                })
                .strict(),
            ]),
            mode: z.enum(['incremental', 'full']).default('incremental'),
          })
          .strict(),
      },
    },
    async (request, reply) => {
      if (!opts.queue)
        return reply.code(503).send({ error: 'Sweep queue unavailable' });
      try {
        const run = await queueSweep(
          app.prisma,
          opts.queue,
          request.user!.id,
          request.body.mode,
          request.body.target,
        );
        return reply.code(202).send(run);
      } catch (error) {
        if (error instanceof SweepTargetError)
          return reply.code(409).send({ error: error.message });
        // pg-boss/Prisma errors may contain SQL or connection details.
        throw new Error('Could not queue sweep');
      }
    },
  );
  r.get(
    '/admin/sweeps',
    {
      schema: {
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(25),
          cursor: z
            .string()
            .transform((value, ctx) => {
              try {
                return z
                  .object({
                    createdAt: z.string().datetime(),
                    id: z.string().uuid(),
                  })
                  .parse(
                    JSON.parse(Buffer.from(value, 'base64url').toString()),
                  );
              } catch {
                ctx.addIssue({
                  code: 'custom',
                  message: 'Invalid history cursor',
                });
                return z.NEVER;
              }
            })
            .optional(),
          status: z
            .enum([
              'QUEUED',
              'RUNNING',
              'SUCCEEDED',
              'SUCCEEDED_WITH_WARNINGS',
              'FAILED',
              'CANCELLED',
              'SKIPPED',
            ])
            .optional(),
          mode: z.enum(['incremental', 'full']).optional(),
          triggerSource: z.enum(['MANUAL', 'SCHEDULED']).optional(),
          target: z
            .string()
            .regex(/^(party|riding:[1-9][0-9]*)$/)
            .refine(
              (value) =>
                value === 'party' || Number(value.split(':')[1]) <= 2147483647,
            )
            .optional(),
        }),
      },
    },
    async (request) => {
      const { limit, cursor, status, mode, triggerSource, target } =
        request.query;
      const runs = await app.prisma.sweepRun.findMany({
        where: {
          status,
          mode,
          triggerSource,
          ...(target
            ? target === 'party'
              ? { target: 'party' }
              : { target: 'riding', ridingNumber: Number(target.split(':')[1]) }
            : {}),
          ...(cursor
            ? {
                OR: [
                  { createdAt: { lt: new Date(cursor.createdAt) } },
                  {
                    createdAt: new Date(cursor.createdAt),
                    id: { lt: cursor.id },
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const data = runs.slice(0, limit);
      const last = data.at(-1);
      return {
        data: data.map(sweepRunView),
        nextCursor:
          runs.length > limit && last
            ? Buffer.from(
                JSON.stringify({
                  createdAt: last.createdAt.toISOString(),
                  id: last.id,
                }),
              ).toString('base64url')
            : null,
      };
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
