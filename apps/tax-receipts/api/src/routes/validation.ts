import type { FastifyInstance } from 'fastify';
import { runValidationForAllContributions } from '../validation/run.js';

/**
 * Manual full-registry re-run (ticket 1.7's "nightly" cadence). A real
 * schedule is ticket 1.15; this is the sysadmin trigger until then, same
 * pattern as `routes/sync.ts`.
 */
export async function validationRoutes(app: FastifyInstance): Promise<void> {
  app.post('/internal/validation/run', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'authentication required' });
    if (!request.ability.can('manage', 'all')) {
      return reply.code(403).send({ error: 'sysadmin only' });
    }
    const result = await runValidationForAllContributions(app.prisma);
    return reply.send(result);
  });
}
