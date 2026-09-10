import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { SessionUser } from '../plugins/auth.js';

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'POST',
    url: '/auth/login',
    preValidation: app.passport.authenticate('local', {
      authInfo: false,
    }) as never,
    schema: {
      body: z.object({ email: z.string().email(), password: z.string() }),
    },
    handler: async (request, reply) => {
      const user = request.user as SessionUser;
      return reply.send({ id: user.id, name: user.name, role: user.role });
    },
  });

  r.post('/auth/logout', async (request, reply) => {
    await request.logout();
    await new Promise<void>((resolve) => request.session.destroy(() => resolve()));
    return reply.send({ ok: true });
  });

  r.get('/auth/me', async (request, reply) => {
    const user = request.user as SessionUser | undefined;
    if (!user) return reply.code(401).send({ error: 'not authenticated' });
    return reply.send({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isCfoDesignate: user.isCfoDesignate,
      allRidings: user.allRidings,
      ridingGrants: user.ridingGrants,
      can: {
        issueReceipts: request.ability.can('issue', 'Receipt'),
        administerKillSwitch: request.ability.can(
          'administer',
          'IssuanceKillSwitch',
        ),
      },
    });
  });
}
