import type { FastifyInstance } from 'fastify';
import { getSpaceDashboard } from '../space/dashboard.js';
import type { SessionUser } from '../plugins/auth.js';

/** Space dashboard (ticket 1.10, screens.md 1). */
export async function spaceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/spaces', async (request, reply) => {
    const user = request.user as SessionUser | undefined;
    if (!user) return reply.code(401).send({ error: 'authentication required' });
    const rows = await getSpaceDashboard(app.prisma, user.allRidings ? null : user.ridingGrants);
    return reply.send({ data: rows });
  });
}
