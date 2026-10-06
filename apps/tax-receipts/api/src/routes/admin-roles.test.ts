import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { resetDb, seedBaseline, testPrisma } from '../test/db.js';

const prisma = testPrisma();
const SECRET = 'test-session-secret-at-least-32-characters-long';

describe('roles and permissions (EO evaluation rows 7 to 10)', () => {
  let app: FastifyInstance;
  let sysadminId: string;

  beforeEach(async () => {
    await resetDb(prisma);
    const baseline = await seedBaseline(prisma);
    await prisma.user.update({
      where: { id: baseline.adminUserId },
      data: { passwordHash: await hashPassword('admin-pass-phrase') },
    });
    sysadminId = (
      await prisma.user.create({
        data: {
          email: 'sysadmin@gpo.test',
          name: 'Sys Admin',
          roleKey: 'sysadmin',
          passwordHash: await hashPassword('sysadmin-pass-phrase'),
          allRidings: true,
        },
      })
    ).id;
    app = await buildApp({ prisma, sessionSecret: SECRET });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function login(email: string, password: string) {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    expect(res.statusCode).toBe(200);
    const c = res.cookies[0]!;
    return { [c.name]: c.value };
  }

  it('lists the built-in roles and the permission catalogue', async () => {
    const cookies = await login('sysadmin@gpo.test', 'sysadmin-pass-phrase');
    const roles = await app.inject({ method: 'GET', url: '/admin/roles', cookies });
    expect(roles.statusCode).toBe(200);
    const data = roles.json().data as Array<{ key: string; builtIn: boolean; locked: boolean; userCount: number }>;
    expect(data).toHaveLength(10);
    expect(data.find((r) => r.key === 'sysadmin')).toMatchObject({ builtIn: true, locked: true, userCount: 1 });
    expect(data.find((r) => r.key === 'party_cfo')).toMatchObject({ locked: false, userCount: 1 });

    const perms = await app.inject({ method: 'GET', url: '/admin/permissions', cookies });
    expect(perms.json().data).toContainEqual(
      expect.objectContaining({ key: 'receipt.issue', group: 'Receipts', label: 'Issue receipts' }),
    );
  });

  it('creates a role, assigns it, and an edit takes effect on the holder\'s next request', async () => {
    const admin = await login('sysadmin@gpo.test', 'sysadmin-pass-phrase');
    const create = await app.inject({
      method: 'POST',
      url: '/admin/roles',
      cookies: admin,
      payload: {
        name: 'Riding Auditor',
        description: 'External auditor for a riding association',
        permissions: ['records.readAll', 'entityReport.generate'],
        reason: 'auditor engaged for 2026',
      },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json()).toMatchObject({
      key: 'riding_auditor',
      builtIn: false,
      permissions: ['entityReport.generate', 'records.readAll'],
    });

    const user = await app.inject({
      method: 'POST',
      url: '/admin/users',
      cookies: admin,
      payload: { name: 'Audrey', email: 'audrey@gpo.test', password: 'a-long-enough-password', role: 'riding_auditor' },
    });
    expect(user.statusCode).toBe(201);
    expect(user.json()).toMatchObject({ role: 'riding_auditor', roleName: 'Riding Auditor' });

    const auditor = await login('audrey@gpo.test', 'a-long-enough-password');
    const me = await app.inject({ method: 'GET', url: '/auth/me', cookies: auditor });
    expect(me.json()).toMatchObject({
      role: 'riding_auditor',
      roleName: 'Riding Auditor',
      can: { generateEntityReports: true, issueReceipts: false, administerUsers: false },
    });

    const edit = await app.inject({
      method: 'PATCH',
      url: '/admin/roles/riding_auditor',
      cookies: admin,
      payload: { permissions: ['records.readAll', 'entityReport.generate', 'entityReport.share'], reason: 'may now share' },
    });
    expect(edit.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/auth/me', cookies: auditor });
    expect(after.json().can).toMatchObject({ shareEntityReports: true });

    const log = await prisma.changeLogEntry.findMany({
      where: { subjectType: 'Role', subjectId: 'riding_auditor' },
      orderBy: { at: 'asc' },
    });
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ actorUserId: sysadminId, reason: 'auditor engaged for 2026', before: null });
    expect(log[1]).toMatchObject({
      reason: 'may now share',
      before: expect.objectContaining({ permissions: ['entityReport.generate', 'records.readAll'] }),
      after: expect.objectContaining({
        permissions: ['entityReport.generate', 'entityReport.share', 'records.readAll'],
      }),
    });
  });

  it('reassigning a user to another role changes their access', async () => {
    const admin = await login('sysadmin@gpo.test', 'sysadmin-pass-phrase');
    const target = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@gpo.test' } });
    const patch = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}`,
      cookies: admin,
      payload: { role: 'party_cfo' },
    });
    expect(patch.json()).toMatchObject({ role: 'party_cfo', roleName: 'Party CFO' });
    const cookies = await login('admin@gpo.test', 'admin-pass-phrase');
    const me = await app.inject({ method: 'GET', url: '/auth/me', cookies });
    expect(me.json().can).toMatchObject({ issueReceipts: true });

    const bad = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}`,
      cookies: admin,
      payload: { role: 'no_such_role' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('protects the sysadmin role, built-in roles, and roles still in use', async () => {
    const admin = await login('sysadmin@gpo.test', 'sysadmin-pass-phrase');
    const lockedEdit = await app.inject({
      method: 'PATCH',
      url: '/admin/roles/sysadmin',
      cookies: admin,
      payload: { permissions: [], reason: 'trying to lock everyone out' },
    });
    expect(lockedEdit.statusCode).toBe(409);

    const builtInDelete = await app.inject({
      method: 'DELETE',
      url: '/admin/roles/readonly',
      cookies: admin,
      payload: { reason: 'not needed' },
    });
    expect(builtInDelete.statusCode).toBe(409);

    await app.inject({
      method: 'POST',
      url: '/admin/roles',
      cookies: admin,
      payload: { name: 'Temp', permissions: [], reason: 'short-lived role' },
    });
    const holder = await prisma.user.create({
      data: { email: 't@gpo.test', name: 'T', roleKey: 'temp', passwordHash: 'x' },
    });
    const inUse = await app.inject({
      method: 'DELETE',
      url: '/admin/roles/temp',
      cookies: admin,
      payload: { reason: 'cleanup' },
    });
    expect(inUse.statusCode).toBe(409);

    await prisma.user.update({ where: { id: holder.id }, data: { roleKey: 'readonly' } });
    const del = await app.inject({
      method: 'DELETE',
      url: '/admin/roles/temp',
      cookies: admin,
      payload: { reason: 'cleanup' },
    });
    expect(del.statusCode).toBe(204);
    expect(await prisma.role.findUnique({ where: { key: 'temp' } })).toBeNull();
    const entry = await prisma.changeLogEntry.findFirst({
      where: { subjectType: 'Role', subjectId: 'temp', reason: 'cleanup' },
    });
    expect(entry).toMatchObject({ after: null, before: expect.objectContaining({ name: 'Temp' }) });
  });

  it('validates role input', async () => {
    const admin = await login('sysadmin@gpo.test', 'sysadmin-pass-phrase');
    const unknownPermission = await app.inject({
      method: 'POST',
      url: '/admin/roles',
      cookies: admin,
      payload: { name: 'X', permissions: ['receipt.teleport'], reason: 'test' },
    });
    expect(unknownPermission.statusCode).toBe(400);

    const duplicate = await app.inject({
      method: 'POST',
      url: '/admin/roles',
      cookies: admin,
      payload: { name: 'Party CFO', permissions: [], reason: 'test' },
    });
    expect(duplicate.statusCode).toBe(409);

    const noReason = await app.inject({
      method: 'POST',
      url: '/admin/roles',
      cookies: admin,
      payload: { name: 'Y', permissions: [] },
    });
    expect(noReason.statusCode).toBe(400);
  });

  it('role and user writes need users.administer, which a custom role can hold', async () => {
    const administrator = await login('admin@gpo.test', 'admin-pass-phrase');
    const refused = await app.inject({
      method: 'POST',
      url: '/admin/roles',
      cookies: administrator,
      payload: { name: 'Sneaky', permissions: ['system.manage'], reason: 'escalation' },
    });
    expect(refused.statusCode).toBe(403);

    const admin = await login('sysadmin@gpo.test', 'sysadmin-pass-phrase');
    await app.inject({
      method: 'POST',
      url: '/admin/roles',
      cookies: admin,
      payload: { name: 'User Manager', permissions: ['users.administer'], reason: 'delegate user admin' },
    });
    const target = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@gpo.test' } });
    await prisma.user.update({ where: { id: target.id }, data: { roleKey: 'user_manager' } });

    const created = await app.inject({
      method: 'POST',
      url: '/admin/users',
      cookies: administrator,
      payload: { name: 'New', email: 'new@gpo.test', password: 'a-long-enough-password', role: 'readonly' },
    });
    expect(created.statusCode).toBe(201);
    const period = await app.inject({
      method: 'PUT',
      url: '/admin/periods/2020',
      cookies: administrator,
      payload: { name: '2020 Annual', kind: 'ANNUAL', startsAt: '2020-01-01T05:00:00Z', endsAt: '2021-01-01T05:00:00Z', reason: 'new period' },
    });
    expect(period.statusCode).toBe(403);
  });
});
