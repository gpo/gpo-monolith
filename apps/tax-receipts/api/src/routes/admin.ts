import { PeriodKind, ContributionLimitBucket } from '@gpo/tax-receipts-core';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppAbility } from '../auth/abilities.js';
import { hashPassword } from '../auth/password.js';
import { LOCKED_ROLE_KEYS, PERMISSION_KEYS, PERMISSIONS } from '../auth/permissions.js';
import { roleKeyFromName } from '../auth/roles.js';
import { sessionsOfUser } from '../auth/session-store.js';
import { withChangeLog } from '../changelog/write.js';
import { listOutstandingDonorPrechecks } from '../donors/precheck.js';
import {
  createLeadershipContestant,
  listLeadershipContestants,
  updateLeadershipContestant,
} from '../leadership/contestants.js';
import type { SessionUser } from '../plugins/auth.js';
import { getReceiptSettings, setReceiptLayout } from '../receipts/settings.js';
import { runValidationForAllContributions } from '../validation/run.js';

/**
 * Annual settings and admin (ticket 1.12, screens.md 11): periods,
 * ContributionLimit buckets, users/roles, the RTD holiday calendar,
 * per-riding Qomon spaces, and leadership contestants. Period, limit, and
 * contestant writes take a reason and are change-logged (EO evaluation row
 * 19). Settings writes need `administer Period` (`settings.administer`);
 * user and role writes need `administer User` (`users.administer`); see
 * auth/permissions.ts. Reads need only authentication, matching every other
 * list route.
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
    schema: {
      params: z.object({ id: z.coerce.number().int() }),
      body: PeriodBody.omit({ id: true }).extend({ reason: z.string().trim().min(3) }),
    },
    handler: async (request, reply) => {
      const auth = requireAdmin(request.user as SessionUser | undefined, request.ability);
      if (!auth.ok) return reply.code(auth.code).send({ error: auth.error });
      const { reason, ...fields } = request.body;
      const id = request.params.id;
      // change-logged (EO evaluation row 19): a period's window decides
      // which contributions count toward it
      const period = await withChangeLog(app.prisma, { userId: auth.user.id, reason }, async (ctx) => {
        const before = await ctx.tx.period.findUnique({ where: { id } });
        const after = await ctx.tx.period.upsert({ where: { id }, create: { id, ...fields }, update: fields });
        await ctx.log({ subjectType: 'Period', subjectId: String(id), before: before ?? undefined, after });
        return after;
      });
      // "an edit re-runs validation A1" (screens.md 11) — the period window
      // check touches every contribution, not just ones in this period, so
      // the full registry re-runs rather than a scoped subset.
      const revalidation = await runValidationForAllContributions(app.prisma);
      return reply.send({ period, revalidation });
    },
  });

  // ---- Receipt settings ----------------------------------------------

  r.get('/admin/receipt-settings', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'authentication required' });
    return reply.send(await getReceiptSettings(app.prisma));
  });

  r.route({
    method: 'PUT',
    url: '/admin/receipt-settings',
    schema: {
      body: z.object({ receiptLayout: z.enum(['LEGACY', 'CONTRIBUTOR_TYPE']), reason: z.string().trim().min(3) }),
    },
    handler: async (request, reply) => {
      const auth = requireAdmin(request.user as SessionUser | undefined, request.ability);
      if (!auth.ok) return reply.code(auth.code).send({ error: auth.error });
      const { receiptLayout, reason } = request.body;
      return reply.send(await setReceiptLayout(app.prisma, { userId: auth.user.id, reason }, receiptLayout));
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
    schema: { body: LimitBody.extend({ reason: z.string().trim().min(3) }) },
    handler: async (request, reply) => {
      const auth = requireAdmin(request.user as SessionUser | undefined, request.ability);
      if (!auth.ok) return reply.code(auth.code).send({ error: auth.error });
      const { year, bucket, reason, ...rest } = request.body;
      const row = await withChangeLog(app.prisma, { userId: auth.user.id, reason }, async (ctx) => {
        const before = await ctx.tx.contributionLimit.findUnique({ where: { year_bucket: { year, bucket } } });
        const after = await ctx.tx.contributionLimit.upsert({
          where: { year_bucket: { year, bucket } },
          create: { year, bucket, ...rest },
          update: rest,
        });
        await ctx.log({ subjectType: 'ContributionLimit', subjectId: after.id, before: before ?? undefined, after });
        return after;
      });
      return reply.send(row);
    },
  });

  r.route({
    method: 'DELETE',
    url: '/admin/contribution-limits/:id',
    schema: { params: z.object({ id: z.string() }), body: z.object({ reason: z.string().trim().min(3) }) },
    handler: async (request, reply) => {
      const auth = requireAdmin(request.user as SessionUser | undefined, request.ability);
      if (!auth.ok) return reply.code(auth.code).send({ error: auth.error });
      const existing = await app.prisma.contributionLimit.findUnique({ where: { id: request.params.id } });
      if (!existing) return reply.code(404).send({ error: 'no such contribution limit' });
      await withChangeLog(app.prisma, { userId: auth.user.id, reason: request.body.reason }, async (ctx) => {
        await ctx.tx.contributionLimit.delete({ where: { id: existing.id } });
        // the entry keeps the removed bucket, so the limit that applied
        // stays on record
        await ctx.log({ subjectType: 'ContributionLimit', subjectId: existing.id, before: existing });
      });
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

  // ---- Leadership contestants (EO evaluation row 25) -----------------

  // Read by every entry form that can direct a contribution to a contestant,
  // so it needs only authentication, like the periods and ridings lists.
  r.get('/admin/leadership-contestants', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'authentication required' });
    return reply.send({ data: await listLeadershipContestants(app.prisma) });
  });

  const ContestantBody = z.object({
    name: z.string().trim().min(1),
    contestName: z.string().trim().min(1),
    active: z.boolean().optional(),
  });

  r.route({
    method: 'POST',
    url: '/admin/leadership-contestants',
    schema: { body: ContestantBody.extend({ reason: z.string().trim().min(3) }) },
    handler: async (request, reply) => {
      const auth = requireAdmin(request.user as SessionUser | undefined, request.ability);
      if (!auth.ok) return reply.code(auth.code).send({ error: auth.error });
      const { reason, ...fields } = request.body;
      const created = await createLeadershipContestant(app.prisma, { ...fields, actorUserId: auth.user.id, reason });
      return reply.code(201).send(created);
    },
  });

  r.route({
    method: 'PATCH',
    url: '/admin/leadership-contestants/:id',
    schema: {
      params: z.object({ id: z.string() }),
      body: ContestantBody.partial().extend({ reason: z.string().trim().min(3) }),
    },
    handler: async (request, reply) => {
      const auth = requireAdmin(request.user as SessionUser | undefined, request.ability);
      if (!auth.ok) return reply.code(auth.code).send({ error: auth.error });
      const { reason, ...fields } = request.body;
      const updated = await updateLeadershipContestant(app.prisma, {
        id: request.params.id,
        ...fields,
        actorUserId: auth.user.id,
        reason,
      });
      if (!updated) return reply.code(404).send({ error: 'no such leadership contestant' });
      return reply.send(updated);
    },
  });

  // ---- Users & roles ---------------------------------------------------
  // EO evaluation rows 4, 5, and 7 to 12. A role is a row in `role` holding
  // permission keys from the catalogue in auth/permissions.ts; a user holds
  // one role. User writes are change-logged under subject type User (never
  // with the password hash) and role writes under Role.

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

  /** Emails are stored lower-cased: login looks them up lower-cased. */
  const Email = z.string().trim().email().transform((e) => e.toLowerCase());

  async function emailTaken(email: string, exceptId?: string): Promise<boolean> {
    const holder = await app.prisma.user.findUnique({ where: { email }, select: { id: true } });
    return holder !== null && holder.id !== exceptId;
  }

  const CreateUserBody = z.object({
    name: z.string().trim().min(1),
    email: Email,
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
      if (await emailTaken(rest.email)) {
        return reply.code(409).send({ error: `another user already has the email ${rest.email}` });
      }
      const passwordHash = await hashPassword(password);
      const user = await withChangeLog(
        app.prisma,
        { userId: auth.user.id, reason: 'user account created' },
        async (ctx) => {
          const created = await ctx.tx.user.create({
            data: { ...rest, roleKey: role, passwordHash },
            include: { role: { select: { name: true } } },
          });
          await ctx.log({ subjectType: 'User', subjectId: created.id, after: userRow(created) });
          return created;
        },
      );
      return reply.code(201).send(userRow(user));
    },
  });

  const UpdateUserBody = z.object({
    name: z.string().trim().min(1).optional(),
    email: Email.optional(),
    /** a role key */
    role: z.string().min(1).optional(),
    active: z.boolean().optional(),
    allRidings: z.boolean().optional(),
    ridingGrants: z.array(z.number().int().min(1).max(124)).optional(),
    isCfoDesignate: z.boolean().optional(),
    /** recorded in the change log; the quick toggles on the Users page
     *  (active, role) send none and get a generic one */
    reason: z.string().trim().min(3).optional(),
  });

  // EO evaluation row 5 (modify user info) and row 9 (change a user's
  // role). Change-logged with before and after.
  r.route({
    method: 'PATCH',
    url: '/admin/users/:id',
    schema: { params: z.object({ id: z.string() }), body: UpdateUserBody },
    handler: async (request, reply) => {
      const auth = requireUserAdmin(request.user as SessionUser | undefined, request.ability);
      if (!auth.ok) return reply.code(auth.code).send({ error: auth.error });
      const { id } = request.params;
      const { role, reason, ...rest } = request.body;
      if (role !== undefined && !(await roleExists(role))) {
        return reply.code(400).send({ error: `unknown role: ${role}` });
      }
      const before = await app.prisma.user.findUnique({
        where: { id },
        include: { role: { select: { name: true } } },
      });
      if (!before) return reply.code(404).send({ error: 'user not found' });
      if (rest.email !== undefined && (await emailTaken(rest.email, id))) {
        return reply.code(409).send({ error: `another user already has the email ${rest.email}` });
      }
      const user = await withChangeLog(
        app.prisma,
        { userId: auth.user.id, reason: reason ?? 'user account updated' },
        async (ctx) => {
          const updated = await ctx.tx.user.update({
            where: { id },
            data: { ...rest, ...(role !== undefined ? { roleKey: role } : {}) },
            include: { role: { select: { name: true } } },
          });
          await ctx.log({ subjectType: 'User', subjectId: id, before: userRow(before), after: userRow(updated) });
          return updated;
        },
      );
      return reply.send(userRow(user));
    },
  });

  // Admin password reset (EO evaluation row 12): for a user who has
  // forgotten theirs. Signs out every session the user has, and is
  // change-logged with the admin as actor and their reason.
  r.route({
    method: 'POST',
    url: '/admin/users/:id/password',
    schema: {
      params: z.object({ id: z.string() }),
      body: z.object({
        newPassword: z.string().min(12, 'the new password must be at least 12 characters'),
        reason: z.string().trim().min(3),
      }),
    },
    handler: async (request, reply) => {
      const auth = requireUserAdmin(request.user as SessionUser | undefined, request.ability);
      if (!auth.ok) return reply.code(auth.code).send({ error: auth.error });
      const { id } = request.params;
      if (!(await app.prisma.user.findUnique({ where: { id } }))) {
        return reply.code(404).send({ error: 'user not found' });
      }
      const passwordHash = await hashPassword(request.body.newPassword);
      const signedOut = await withChangeLog(
        app.prisma,
        { userId: auth.user.id, reason: request.body.reason },
        async (ctx) => {
          await ctx.tx.user.update({ where: { id }, data: { passwordHash } });
          const { count } = await ctx.tx.session.deleteMany({ where: sessionsOfUser(id) });
          await ctx.log({ subjectType: 'User', subjectId: id, after: { passwordReset: true, sessionsSignedOut: count } });
          return count;
        },
      );
      return reply.send({ ok: true, sessionsSignedOut: signedOut });
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
