import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getKillSwitch, setKillSwitch } from '../auth/kill-switch.js';
import type { SessionUser } from '../plugins/auth.js';

export async function killSwitchRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/admin/kill-switch', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'authentication required' });
    return reply.send(await getKillSwitch(app.prisma));
  });

  r.route({
    method: 'POST',
    url: '/admin/kill-switch',
    schema: {
      body: z.object({
        engaged: z.boolean(),
        reason: z.string().min(3),
      }),
    },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('administer', 'IssuanceKillSwitch')) {
        return reply
          .code(403)
          .send({ error: 'only the party CFO or a sysadmin may operate the kill switch' });
      }
      const { engaged, reason } = request.body;
      const state = await setKillSwitch(
        app.prisma,
        { userId: user.id, reason },
        engaged,
      );
      return reply.send(state);
    },
  });
}
