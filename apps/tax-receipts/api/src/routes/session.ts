import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { sessionsOfUser } from '../auth/session-store.js';
import { withChangeLog } from '../changelog/write.js';
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

  // Self-service password change (EO evaluation row 12). The current
  // password is re-checked even though the session is authenticated, so an
  // unattended signed-in browser cannot be used to take over the account.
  // Every other session the user has is signed out; this one stays.
  r.route({
    method: 'POST',
    url: '/auth/password',
    schema: {
      body: z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(12, 'the new password must be at least 12 characters'),
      }),
    },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      const { currentPassword, newPassword } = request.body;
      const row = await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      if (!(await verifyPassword(currentPassword, row.passwordHash))) {
        return reply.code(400).send({ error: 'the current password is incorrect' });
      }
      if (await verifyPassword(newPassword, row.passwordHash)) {
        return reply.code(400).send({ error: 'the new password must differ from the current one' });
      }
      const passwordHash = await hashPassword(newPassword);
      const signedOut = await withChangeLog(
        app.prisma,
        { userId: user.id, reason: 'changed own password' },
        async (ctx) => {
          await ctx.tx.user.update({ where: { id: user.id }, data: { passwordHash } });
          const { count } = await ctx.tx.session.deleteMany({
            where: { ...sessionsOfUser(user.id), sid: { not: request.session.sessionId } },
          });
          // never the hash: the entry records that the password changed
          await ctx.log({
            subjectType: 'User',
            subjectId: user.id,
            after: { passwordChanged: true, otherSessionsSignedOut: count },
          });
          return count;
        },
      );
      return reply.send({ ok: true, otherSessionsSignedOut: signedOut });
    },
  });

  // Self-service profile edit (EO evaluation row 5). Changing the email,
  // which is the sign-in name, needs the current password, as a password
  // change does; a name change does not.
  r.route({
    method: 'PATCH',
    url: '/auth/profile',
    schema: {
      body: z.object({
        name: z.string().trim().min(1).optional(),
        email: z
          .string()
          .trim()
          .email()
          .transform((e) => e.toLowerCase())
          .optional(),
        currentPassword: z.string().optional(),
      }),
    },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      const { name, email, currentPassword } = request.body;
      const row = await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      const emailChanging = email !== undefined && email !== row.email;
      if (emailChanging) {
        if (!currentPassword || !(await verifyPassword(currentPassword, row.passwordHash))) {
          return reply.code(400).send({ error: 'enter your current password to change your email' });
        }
        const holder = await app.prisma.user.findUnique({ where: { email }, select: { id: true } });
        if (holder) return reply.code(409).send({ error: `another user already has the email ${email}` });
      }
      const data = { ...(name !== undefined ? { name } : {}), ...(emailChanging ? { email } : {}) };
      if (Object.keys(data).length === 0) return reply.send({ name: row.name, email: row.email });
      const updated = await withChangeLog(
        app.prisma,
        { userId: user.id, reason: 'updated own profile' },
        async (ctx) => {
          const next = await ctx.tx.user.update({ where: { id: user.id }, data });
          await ctx.log({
            subjectType: 'User',
            subjectId: user.id,
            before: { name: row.name, email: row.email },
            after: { name: next.name, email: next.email },
          });
          return next;
        },
      );
      return reply.send({ name: updated.name, email: updated.email });
    },
  });

  r.get('/auth/me', async (request, reply) => {
    const user = request.user as SessionUser | undefined;
    if (!user) return reply.code(401).send({ error: 'not authenticated' });
    return reply.send({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      roleName: user.roleName,
      permissions: user.permissions,
      isCfoDesignate: user.isCfoDesignate,
      allRidings: user.allRidings,
      ridingGrants: user.ridingGrants,
      can: {
        issueReceipts: request.ability.can('issue', 'Receipt'),
        sendDonorPrechecks: request.ability.can('update', 'ContributionMetadata'),
        administerKillSwitch: request.ability.can(
          'administer',
          'IssuanceKillSwitch',
        ),
        generateEntityReports: request.ability.can('create', 'EntityReport'),
        shareEntityReports: request.ability.can('share', 'EntityReport'),
        prepareRtdFilings: request.ability.can('create', 'RtdFiling'),
        sendRtdFilings: request.ability.can('file', 'RtdFiling'),
        fileEOForms: request.ability.can('file', 'EOForm'),
        enterPayments: request.ability.can('create', 'Payment'),
        correctContributions: request.ability.can('correct', 'Contribution'),
        correctReceipts: request.ability.can('correct', 'Receipt'),
        administerUsers: request.ability.can('administer', 'User'),
      },
    });
  });
}
