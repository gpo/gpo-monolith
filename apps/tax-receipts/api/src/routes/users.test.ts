import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { resetDb, seedBaseline, testPrisma } from '../test/db.js';

const prisma = testPrisma();
const SECRET = 'test-session-secret-at-least-32-characters-long';

describe('editing user info (EO evaluation row 5)', () => {
  let app: FastifyInstance;
  let cfoId: string;
  let sysadminId: string;

  beforeEach(async () => {
    await resetDb(prisma);
    const baseline = await seedBaseline(prisma);
    cfoId = baseline.cfoUserId;
    await prisma.user.update({
      where: { id: cfoId },
      data: { passwordHash: await hashPassword('cfo-pass-phrase-1') },
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
    if (res.statusCode !== 200) return null;
    const c = res.cookies[0]!;
    return { [c.name]: c.value };
  }

  it('an admin edits a user\'s name and email, change-logged with before and after', async () => {
    const admin = (await login('sysadmin@gpo.test', 'sysadmin-pass-phrase'))!;
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${cfoId}`,
      cookies: admin,
      payload: { name: 'Morgan Treasurer', email: 'Morgan@GPO.test', reason: 'name change after marriage' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Morgan Treasurer', email: 'morgan@gpo.test' });
    expect(await login('morgan@gpo.test', 'cfo-pass-phrase-1')).not.toBeNull();

    const entry = await prisma.changeLogEntry.findFirstOrThrow({ where: { subjectType: 'User', subjectId: cfoId } });
    expect(entry).toMatchObject({
      actorUserId: sysadminId,
      reason: 'name change after marriage',
      before: expect.objectContaining({ name: 'CFO', email: 'cfo@gpo.test' }),
      after: expect.objectContaining({ name: 'Morgan Treasurer', email: 'morgan@gpo.test' }),
    });
    expect(JSON.stringify(entry)).not.toContain('passwordHash');
  });

  it('refuses an email another user has', async () => {
    const admin = (await login('sysadmin@gpo.test', 'sysadmin-pass-phrase'))!;
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${cfoId}`,
      cookies: admin,
      payload: { email: 'admin@gpo.test' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('logs user creation and quick role or active toggles with a generic reason', async () => {
    const admin = (await login('sysadmin@gpo.test', 'sysadmin-pass-phrase'))!;
    const create = await app.inject({
      method: 'POST',
      url: '/admin/users',
      cookies: admin,
      payload: { name: 'New', email: 'NEW@gpo.test', password: 'a-long-enough-password', role: 'readonly' },
    });
    expect(create.json()).toMatchObject({ email: 'new@gpo.test' });
    const id = create.json().id;
    await app.inject({ method: 'PATCH', url: `/admin/users/${id}`, cookies: admin, payload: { active: false } });

    const entries = await prisma.changeLogEntry.findMany({ where: { subjectType: 'User', subjectId: id }, orderBy: { at: 'asc' } });
    expect(entries.map((e) => e.reason)).toEqual(['user account created', 'user account updated']);
    expect(entries[0]).toMatchObject({ before: null, after: expect.objectContaining({ email: 'new@gpo.test' }) });
    expect(entries[1]).toMatchObject({ after: expect.objectContaining({ active: false }) });
  });

  it('a user edits their own name freely, but needs their password to change their email', async () => {
    const cookies = (await login('cfo@gpo.test', 'cfo-pass-phrase-1'))!;
    const rename = await app.inject({ method: 'PATCH', url: '/auth/profile', cookies, payload: { name: 'C. F. O.' } });
    expect(rename.json()).toEqual({ name: 'C. F. O.', email: 'cfo@gpo.test' });

    const noPassword = await app.inject({
      method: 'PATCH',
      url: '/auth/profile',
      cookies,
      payload: { email: 'cfo2@gpo.test' },
    });
    expect(noPassword.statusCode).toBe(400);

    const taken = await app.inject({
      method: 'PATCH',
      url: '/auth/profile',
      cookies,
      payload: { email: 'admin@gpo.test', currentPassword: 'cfo-pass-phrase-1' },
    });
    expect(taken.statusCode).toBe(409);

    const ok = await app.inject({
      method: 'PATCH',
      url: '/auth/profile',
      cookies,
      payload: { email: 'cfo2@gpo.test', currentPassword: 'cfo-pass-phrase-1' },
    });
    expect(ok.json()).toEqual({ name: 'C. F. O.', email: 'cfo2@gpo.test' });
    const me = await app.inject({ method: 'GET', url: '/auth/me', cookies });
    expect(me.json()).toMatchObject({ name: 'C. F. O.', email: 'cfo2@gpo.test' });

    const entries = await prisma.changeLogEntry.findMany({ where: { subjectType: 'User', subjectId: cfoId } });
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.actorUserId === cfoId && e.reason === 'updated own profile')).toBe(true);
  });

  it('a user cannot change their own role or active flag through the profile', async () => {
    const cookies = (await login('cfo@gpo.test', 'cfo-pass-phrase-1'))!;
    await app.inject({
      method: 'PATCH',
      url: '/auth/profile',
      cookies,
      payload: { name: 'CFO', role: 'sysadmin', active: true },
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: cfoId } })).roleKey).toBe('party_cfo');
  });
});
