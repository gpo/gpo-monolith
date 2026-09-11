import { PeriodKind, ContributionLimitBucket, UserRole } from '@gpo/tax-receipts-core';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppAbility } from '../auth/abilities.js';
import { hashPassword } from '../auth/password.js';
import type { SessionUser } from '../plugins/auth.js';
import { runValidationForAllContributions } from '../validation/run.js';

/**
 * Annual settings and admin (ticket 1.12, screens.md 11): periods,
 * ContributionLimit buckets, users/roles, and the RTD holiday calendar. All
 * writes are sysadmin-only (`administer`, the action `auth/abilities.ts`
 * already names for "users, periods, limits, kill switch" — sysadmin's
 * documented role, `enums.ts`: "full config + user admin"); reads need only
 * authentication, matching every other list route.
 *
 * Not built here: the receipt letter template (Phase 3 — no template
 * system exists yet, and template changes route through the EO
 * material-change checklist per compliance.md, not a freeform admin edit)
 * and RTD "CFO name" / sign-off threshold (screens.md names them but no
 * schema field or spec value exists for either — flagged, not invented).
 * The kill switch itself is ticket 0.5's `routes/kill-switch.ts`; this
 * ticket is only its web page.
 */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  function requireAdmin(user: SessionUser | undefined, ability: AppAbility) {
    if (!user) return { ok: false as const, code: 401, error: 'authentication required' };
    if (!ability.can('administer', 'Period')) {
      return { ok: false as const, code: 403, error: 'sysadmin only' };
    }
    return { ok: true as const, user };
  }

  // ---- Periods -------------------------------------------------------

  r.get('/admin/periods', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'authentication required' });
    return reply.send({ data: await app.prisma.period.findMany({ orderBy: { startsAt: 'desc' } }) });
  });

  const PeriodBody = z.object({
    id: z.number().int(),
    name: z.string().min(1),
    kind: PeriodKind,
    ridingNumbers: z.array(z.number().int().min(1).max(124)).default([]),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  });

  r.route({
    method: 'PUT',
    url: '/admin/periods/:id',
    schema: { params: z.object({ id: z.coerce.number().int() }), body: PeriodBody.omit({ id: true }) },
    handler: async (request, reply) => {
      const auth = requireAdmin(request.user as SessionUser | undefined, request.ability);
      if (!auth.ok) return reply.code(auth.code).send({ error: auth.error });
      const period = await app.prisma.period.upsert({
        where: { id: request.params.id },
        create: { id: request.params.id, ...request.body },
        update: request.body,
      });
      // "an edit re-runs validation A1" (screens.md 11) — the period window
      // check touches every contribution, not just ones in this period, so
      // the full registry re-runs rather than a scoped subset.
      const revalidation = await runValidationForAllContributions(app.prisma);
      return reply.send({ period, revalidation });
    },
  });

  // ---- ContributionLimit buckets --------------------------------------

  r.get('/admin/contribution-limits', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'authentication required' });
    return reply.send({
      data: await app.prisma.contributionLimit.findMany({ orderBy: [{ year: 'desc' }, { bucket: 'asc' }] }),
    });
  });

  const LimitBody = z.object({
    year: z.number().int(),
    bucket: ContributionLimitBucket,
    amountCents: z.number().int().min(0),
    notes: z.string().nullish(),
  });

  r.route({
    method: 'PUT',
    url: '/admin/contribution-limits',
    schema: { body: LimitBody },
    handler: async (request, reply) => {
      const auth = requireAdmin(request.user as SessionUser | undefined, request.ability);
      if (!auth.ok) return reply.code(auth.code).send({ error: auth.error });
      const { year, bucket, ...rest } = request.body;
      const row = await app.prisma.contributionLimit.upsert({
        where: { year_bucket: { year, bucket } },
        create: { year, bucket, ...rest },
        update: rest,
      });
      return reply.send(row);
    },
  });

  r.route({
    method: 'DELETE',
    url: '/admin/contribution-limits/:id',
    schema: { params: z.object({ id: z.string() }) },
    handler: async (request, reply) => {
      const auth = requireAdmin(request.user as SessionUser | undefined, request.ability);
      if (!auth.ok) return reply.code(auth.code).send({ error: auth.error });
      await app.prisma.contributionLimit.delete({ where: { id: request.params.id } });
      return reply.code(204).send();
    },
  });

  // ---- RTD business-day calendar (holidays) ---------------------------

  r.get('/admin/business-day-calendars', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'authentication required' });
    return reply.send({
      data: await app.prisma.businessDayCalendar.findMany({ orderBy: { year: 'desc' } }),
    });
  });

  r.route({
    method: 'PUT',
    url: '/admin/business-day-calendars/:year',
    schema: {
      params: z.object({ year: z.coerce.number().int() }),
      body: z.object({ holidays: z.array(z.string().date()) }),
    },
    handler: async (request, reply) => {
      const auth = requireAdmin(request.user as SessionUser | undefined, request.ability);
      if (!auth.ok) return reply.code(auth.code).send({ error: auth.error });
      const row = await app.prisma.businessDayCalendar.upsert({
        where: { year: request.params.year },
        create: { year: request.params.year, holidays: request.body.holidays },
        update: { holidays: request.body.holidays },
      });
      return reply.send(row);
    },
  });

  // ---- Users & roles ---------------------------------------------------

  r.get('/admin/users', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'authentication required' });
    const users = await app.prisma.user.findMany({ orderBy: { name: 'asc' } });
    return reply.send({
      data: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        active: u.active,
        isCfoDesignate: u.isCfoDesignate,
        allRidings: u.allRidings,
        ridingGrants: u.ridingGrants,
      })),
    });
  });

  const CreateUserBody = z.object({
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(12),
    role: UserRole,
    allRidings: z.boolean().default(false),
    ridingGrants: z.array(z.number().int().min(1).max(124)).default([]),
    isCfoDesignate: z.boolean().default(false),
  });

  r.route({
    method: 'POST',
    url: '/admin/users',
    schema: { body: CreateUserBody },
    handler: async (request, reply) => {
      const auth = requireAdmin(request.user as SessionUser | undefined, request.ability);
      if (!auth.ok) return reply.code(auth.code).send({ error: auth.error });
      const { password, ...rest } = request.body;
      const user = await app.prisma.user.create({
        data: { ...rest, passwordHash: await hashPassword(password) },
      });
      return reply.code(201).send({ id: user.id, name: user.name, email: user.email, role: user.role });
    },
  });

  const UpdateUserBody = z.object({
    role: UserRole.optional(),
    active: z.boolean().optional(),
    allRidings: z.boolean().optional(),
    ridingGrants: z.array(z.number().int().min(1).max(124)).optional(),
    isCfoDesignate: z.boolean().optional(),
  });

  r.route({
    method: 'PATCH',
    url: '/admin/users/:id',
    schema: { params: z.object({ id: z.string() }), body: UpdateUserBody },
    handler: async (request, reply) => {
      const auth = requireAdmin(request.user as SessionUser | undefined, request.ability);
      if (!auth.ok) return reply.code(auth.code).send({ error: auth.error });
      const user = await app.prisma.user.update({ where: { id: request.params.id }, data: request.body });
      return reply.send({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        active: user.active,
        isCfoDesignate: user.isCfoDesignate,
        allRidings: user.allRidings,
        ridingGrants: user.ridingGrants,
      });
    },
  });
}
