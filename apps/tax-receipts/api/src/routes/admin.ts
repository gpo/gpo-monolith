import { PeriodKind, ContributionLimitBucket } from '@gpo/tax-receipts-core';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppAbility } from '../auth/abilities.js';
import { hashPassword } from '../auth/password.js';
import { LOCKED_ROLE_KEYS, PERMISSION_KEYS, PERMISSIONS } from '../auth/permissions.js';
import { roleKeyFromName } from '../auth/roles.js';
import { withChangeLog } from '../changelog/write.js';
import { listOutstandingDonorPrechecks } from '../donors/precheck.js';
import type { SessionUser } from '../plugins/auth.js';
import { runValidationForAllContributions } from '../validation/run.js';

/**
 * Annual settings and admin (ticket 1.12, screens.md 11): periods,
 * ContributionLimit buckets, users/roles, the RTD holiday calendar, and
 * per-riding Qomon spaces. Settings writes need `administer Period`
 * (`settings.administer`); user and role writes need `administer User`
 * (`users.administer`); see auth/permissions.ts. Reads need only
 * authentication, matching every other list route.
 * The one exception is a riding's `qomonApiKey`: never round-tripped back
 * out of a GET, sysadmin-only or not (see `redactRiding` below).
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

  /** Users and roles have their own permission (`users.administer`), so a
   *  role can be given user administration without the annual settings. */
  function requireUserAdmin(user: SessionUser | undefined, ability: AppAbility) {
    if (!user) return { ok: false as const, code: 401, error: 'authentication required' };
    if (!ability.can('administer', 'User')) {
      return { ok: false as const, code: 403, error: 'you do not have permission to manage users and roles' };
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

  // ---- Ridings (per-riding Qomon spaces) -------------------------------

  function redactRiding(riding: {
    ridingNumber: number;
    name: string;
    qomonApiKey: string;
    qomonApiBase: string | null;
    active: boolean;
    updatedAt: Date;
  }) {
    // the key itself is never round-tripped once set (same principle as
    // User.passwordHash) — callers see only whether one is on file. Trimmed
    // defensively: a whitespace-only value is not a usable key.
    const { qomonApiKey, ...rest } = riding;
    return { ...rest, qomonApiKeySet: qomonApiKey.trim().length > 0 };
  }

  r.get('/admin/ridings', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'authentication required' });
    const ridings = await app.prisma.riding.findMany({ orderBy: { ridingNumber: 'asc' } });
    return reply.send({ data: ridings.map(redactRiding) });
  });

  const RidingBody = z
    .object({
      name: z.string().min(1),
      // required for an active riding; an inactive one may be saved without
      // a key (e.g. not yet live, or retired) — see qomonApiKeySet above.
      // trimmed so a whitespace-only value doesn't count as "set".
      qomonApiKey: z.string().trim(),
      qomonApiBase: z.string().url().nullish(),
      active: z.boolean().default(true),
    })
    .refine((body) => body.active === false || body.qomonApiKey.length > 0, {
      message: 'Qomon API key is required for an active riding',
      path: ['qomonApiKey'],
    });

  r.route({
    method: 'PUT',
    url: '/admin/ridings/:ridingNumber',
    schema: {
      params: z.object({ ridingNumber: z.coerce.number().int().min(1).max(124) }),
      body: RidingBody,
    },
    handler: async (request, reply) => {
      const auth = requireAdmin(request.user as SessionUser | undefined, request.ability);
      if (!auth.ok) return reply.code(auth.code).send({ error: auth.error });
      const { ridingNumber } = request.params;
      const riding = await app.prisma.riding.upsert({
        where: { ridingNumber },
        create: { ridingNumber, ...request.body },
        update: request.body,
      });
      return reply.send(redactRiding(riding));
    },
  });

  const UpdateRidingBody = z.object({
    name: z.string().min(1).optional(),
    /** omit to leave the existing key in place; it is never read back, so a
     *  rotate is the only way for a caller to know they're changing it. */
    qomonApiKey: z.string().trim().min(1).optional(),
    qomonApiBase: z.string().url().nullish(),
    active: z.boolean().optional(),
  });

  r.route({
    method: 'PATCH',
    url: '/admin/ridings/:ridingNumber',
    schema: {
      params: z.object({ ridingNumber: z.coerce.number().int() }),
      body: UpdateRidingBody,
    },
    handler: async (request, reply) => {
      const auth = requireAdmin(request.user as SessionUser | undefined, request.ability);
      if (!auth.ok) return reply.code(auth.code).send({ error: auth.error });
      const current = await app.prisma.riding.findUnique({ where: { ridingNumber: request.params.ridingNumber } });
      if (!current) return reply.code(404).send({ error: 'riding not found' });
      // qomonApiKey is omitted from most patches (it leaves the key in place),
      // so the active-requires-a-key check has to look at the merged result,
      // not the patch body in isolation.
      const nextActive = request.body.active ?? current.active;
      const nextKey = request.body.qomonApiKey ?? current.qomonApiKey;
      if (nextActive && nextKey.trim().length === 0) {
        return reply.code(400).send({ error: 'Qomon API key is required for an active riding' });
      }
      const riding = await app.prisma.riding.update({
        where: { ridingNumber: request.params.ridingNumber },
        data: request.body,
      });
      return reply.send(redactRiding(riding));
    },
  });

  r.route({
    method: 'DELETE',
    url: '/admin/ridings/:ridingNumber',
    schema: { params: z.object({ ridingNumber: z.coerce.number().int() }) },
    handler: async (request, reply) => {
      const auth = requireAdmin(request.user as SessionUser | undefined, request.ability);
      if (!auth.ok) return reply.code(auth.code).send({ error: auth.error });
      await app.prisma.riding.delete({ where: { ridingNumber: request.params.ridingNumber } });
      return reply.code(204).send();
    },
  });

  // bulk-load the riding directory (e.g. Elections Ontario's provincial
  // riding list) from a file like ontario-ridings.json: upsert by
  // ridingNumber so re-importing an updated file never creates duplicates.
  // Unlike the single-riding PUT above, this does NOT require a Qomon key
  // on an active row — a directory import is seeding/refreshing which
  // ridings exist, not declaring one ready for live Qomon sync, and a
  // real export of this data has no key to give (see qomonApiKeySet: it
  // never round-trips). A blank qomonApiKey on an existing riding leaves
  // its key in place, same rule as PATCH. Fields the schema doesn't have
  // (e.g. effectiveFrom) are accepted in the input and silently dropped —
  // not invented — rather than rejecting the whole file over them.
  const RidingImportRow = z.object({
    ridingNumber: z.number().int().min(1).max(124),
    name: z.string().min(1),
    qomonApiKey: z.string().trim().default(''),
    qomonApiBase: z.string().url().nullish(),
    active: z.boolean().default(true),
  });

  r.route({
    method: 'POST',
    url: '/admin/ridings/import',
    schema: { body: z.array(RidingImportRow).min(1) },
    handler: async (request, reply) => {
      const auth = requireAdmin(request.user as SessionUser | undefined, request.ability);
      if (!auth.ok) return reply.code(auth.code).send({ error: auth.error });

      let created = 0;
      let updated = 0;
      const data = [];
      for (const row of request.body) {
        const existing = await app.prisma.riding.findUnique({ where: { ridingNumber: row.ridingNumber } });
        const riding = await app.prisma.riding.upsert({
          where: { ridingNumber: row.ridingNumber },
          create: {
            ridingNumber: row.ridingNumber,
            name: row.name,
            qomonApiKey: row.qomonApiKey,
            qomonApiBase: row.qomonApiBase ?? null,
            active: row.active,
          },
          update: {
            name: row.name,
            ...(row.qomonApiKey.length > 0 ? { qomonApiKey: row.qomonApiKey } : {}),
            qomonApiBase: row.qomonApiBase ?? null,
            active: row.active,
          },
        });
        if (existing) updated++;
        else created++;
        data.push(redactRiding(riding));
      }
      return reply.send({ imported: data.length, created, updated, data });
    },
  });

  // ---- Users & roles ---------------------------------------------------
  // EO evaluation rows 4 and 7 to 10. A role is a row in `role` holding
  // permission keys from the catalogue in auth/permissions.ts; a user holds
  // one role. Role writes are change-logged (subject type Role).

  function userRow(u: {
    id: string;
    name: string;
    email: string;
    roleKey: string;
    role: { name: string };
    active: boolean;
    isCfoDesignate: boolean;
    allRidings: boolean;
    ridingGrants: number[];
  }) {
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.roleKey,
      roleName: u.role.name,
      active: u.active,
      isCfoDesignate: u.isCfoDesignate,
      allRidings: u.allRidings,
      ridingGrants: u.ridingGrants,
    };
  }

  async function roleExists(key: string): Promise<boolean> {
    return (await app.prisma.role.count({ where: { key } })) > 0;
  }

  r.get('/admin/users', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'authentication required' });
    const users = await app.prisma.user.findMany({
      orderBy: { name: 'asc' },
      include: { role: { select: { name: true } } },
    });
    return reply.send({ data: users.map(userRow) });
  });

  const CreateUserBody = z.object({
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(12),
    /** a role key */
    role: z.string().min(1),
    allRidings: z.boolean().default(false),
    ridingGrants: z.array(z.number().int().min(1).max(124)).default([]),
    isCfoDesignate: z.boolean().default(false),
  });

  r.route({
    method: 'POST',
    url: '/admin/users',
    schema: { body: CreateUserBody },
    handler: async (request, reply) => {
      const auth = requireUserAdmin(request.user as SessionUser | undefined, request.ability);
      if (!auth.ok) return reply.code(auth.code).send({ error: auth.error });
      const { password, role, ...rest } = request.body;
      if (!(await roleExists(role))) return reply.code(400).send({ error: `unknown role: ${role}` });
      const user = await app.prisma.user.create({
        data: { ...rest, roleKey: role, passwordHash: await hashPassword(password) },
        include: { role: { select: { name: true } } },
      });
      return reply.code(201).send(userRow(user));
    },
  });

  const UpdateUserBody = z.object({
    /** a role key */
    role: z.string().min(1).optional(),
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
      const auth = requireUserAdmin(request.user as SessionUser | undefined, request.ability);
      if (!auth.ok) return reply.code(auth.code).send({ error: auth.error });
      const { role, ...rest } = request.body;
      if (role !== undefined && !(await roleExists(role))) {
        return reply.code(400).send({ error: `unknown role: ${role}` });
      }
      const user = await app.prisma.user.update({
        where: { id: request.params.id },
        data: { ...rest, ...(role !== undefined ? { roleKey: role } : {}) },
        include: { role: { select: { name: true } } },
      });
      return reply.send(userRow(user));
    },
  });

  r.get('/admin/permissions', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'authentication required' });
    return reply.send({
      data: PERMISSION_KEYS.map((key) => {
        const { group, label, description } = PERMISSIONS[key];
        return { key, group, label, description };
      }),
    });
  });

  const roleInclude = {
    permissions: { select: { permission: true } },
    _count: { select: { users: true } },
  } as const;

  type RoleWithPermissions = {
    key: string;
    name: string;
    description: string;
    builtIn: boolean;
    permissions: Array<{ permission: string }>;
    _count: { users: number };
  };

  function roleRow(role: RoleWithPermissions) {
    return {
      key: role.key,
      name: role.name,
      description: role.description,
      builtIn: role.builtIn,
      locked: LOCKED_ROLE_KEYS.has(role.key),
      permissions: role.permissions.map((p) => p.permission).sort(),
      userCount: role._count.users,
    };
  }

  /** What the change log records for a role: its definition, not counts. */
  function roleSnapshot(role: RoleWithPermissions) {
    const { userCount: _u, locked: _l, ...rest } = roleRow(role);
    return rest;
  }

  r.get('/admin/roles', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'authentication required' });
    const roles = await app.prisma.role.findMany({
      orderBy: [{ builtIn: 'desc' }, { name: 'asc' }],
      include: roleInclude,
    });
    return reply.send({ data: roles.map(roleRow) });
  });

  const PermissionKeys = z
    .array(z.enum(PERMISSION_KEYS))
    .transform((keys) => [...new Set(keys)]);
  const Reason = z.string().trim().min(3);

  const CreateRoleBody = z.object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).default(''),
    permissions: PermissionKeys,
    reason: Reason,
  });

  r.route({
    method: 'POST',
    url: '/admin/roles',
    schema: { body: CreateRoleBody },
    handler: async (request, reply) => {
      const auth = requireUserAdmin(request.user as SessionUser | undefined, request.ability);
      if (!auth.ok) return reply.code(auth.code).send({ error: auth.error });
      const { name, description, permissions, reason } = request.body;
      const key = roleKeyFromName(name);
      if (!key) return reply.code(400).send({ error: 'the role name needs at least one letter or digit' });
      if (await roleExists(key)) {
        return reply.code(409).send({ error: `a role with the key "${key}" already exists; choose another name` });
      }
      const role = await withChangeLog(app.prisma, { userId: auth.user.id, reason }, async (ctx) => {
        const created = await ctx.tx.role.create({
          data: { key, name, description, permissions: { create: permissions.map((permission) => ({ permission })) } },
          include: roleInclude,
        });
        await ctx.log({ subjectType: 'Role', subjectId: key, after: roleSnapshot(created) });
        return created;
      });
      return reply.code(201).send(roleRow(role));
    },
  });

  const UpdateRoleBody = z.object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).optional(),
    permissions: PermissionKeys.optional(),
    reason: Reason,
  });

  r.route({
    method: 'PATCH',
    url: '/admin/roles/:key',
    schema: { params: z.object({ key: z.string() }), body: UpdateRoleBody },
    handler: async (request, reply) => {
      const auth = requireUserAdmin(request.user as SessionUser | undefined, request.ability);
      if (!auth.ok) return reply.code(auth.code).send({ error: auth.error });
      const { key } = request.params;
      const { permissions, reason, ...fields } = request.body;
      if (LOCKED_ROLE_KEYS.has(key)) {
        return reply.code(409).send({ error: 'the system administrator role cannot be changed' });
      }
      const before = await app.prisma.role.findUnique({ where: { key }, include: roleInclude });
      if (!before) return reply.code(404).send({ error: 'role not found' });
      const role = await withChangeLog(app.prisma, { userId: auth.user.id, reason }, async (ctx) => {
        if (permissions) {
          await ctx.tx.rolePermission.deleteMany({ where: { roleKey: key } });
          await ctx.tx.rolePermission.createMany({
            data: permissions.map((permission) => ({ roleKey: key, permission })),
          });
        }
        const updated = await ctx.tx.role.update({ where: { key }, data: fields, include: roleInclude });
        await ctx.log({
          subjectType: 'Role',
          subjectId: key,
          before: roleSnapshot(before),
          after: roleSnapshot(updated),
        });
        return updated;
      });
      return reply.send(roleRow(role));
    },
  });

  r.route({
    method: 'DELETE',
    url: '/admin/roles/:key',
    schema: { params: z.object({ key: z.string() }), body: z.object({ reason: Reason }) },
    handler: async (request, reply) => {
      const auth = requireUserAdmin(request.user as SessionUser | undefined, request.ability);
      if (!auth.ok) return reply.code(auth.code).send({ error: auth.error });
      const { key } = request.params;
      const role = await app.prisma.role.findUnique({ where: { key }, include: roleInclude });
      if (!role) return reply.code(404).send({ error: 'role not found' });
      if (role.builtIn) return reply.code(409).send({ error: 'built-in roles cannot be deleted' });
      if (role._count.users > 0) {
        return reply.code(409).send({
          error: `${role._count.users} user(s) still hold this role; assign them another role first`,
        });
      }
      await withChangeLog(app.prisma, { userId: auth.user.id, reason: request.body.reason }, async (ctx) => {
        await ctx.tx.role.delete({ where: { key } });
        await ctx.log({ subjectType: 'Role', subjectId: key, before: roleSnapshot(role) });
      });
      return reply.code(204).send();
    },
  });

  // ---- Donor pre-check outbox (ticket 3.9 dev tool) -------------------
  // Sysadmin-only, not "any authenticated read" like the lists above: a
  // confirmation token is a bearer credential over a donor's own
  // DonorCyclePreference. Backs dev-tools.tsx's "pre-check outbox" — with no
  // real email provider (O24), it's the only way to find a just-sent link.

  r.get('/admin/donor-prechecks', async (request, reply) => {
    const auth = requireAdmin(request.user as SessionUser | undefined, request.ability);
    if (!auth.ok) return reply.code(auth.code).send({ error: auth.error });
    const data = await listOutstandingDonorPrechecks(app.prisma);
    return reply.send({ data });
  });
}
