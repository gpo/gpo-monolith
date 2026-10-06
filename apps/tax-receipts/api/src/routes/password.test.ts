import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { resetDb, seedBaseline, testPrisma } from '../test/db.js';

const prisma = testPrisma();
const SECRET = 'test-session-secret-at-least-32-characters-long';

describe('password change and reset (EO evaluation row 12)', () => {
  let app: FastifyInstance;
  let cfoId: string;
  let sysadminId: string;

  beforeEach(async () => {
    await resetDb(prisma);
    const baseline = await seedBaseline(prisma);
    cfoId = baseline.cfoUserId;
    await prisma.user.update({
      where: { id: cfoId },
      data: { passwordHash: await hashPassword('original-pass-phrase') },
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

  async function signedIn(cookies: Record<string, string>) {
    const me = await app.inject({ method: 'GET', url: '/auth/me', cookies });
    return me.statusCode === 200;
  }

  it('a user changes their own password; other sessions are signed out, this one stays', async () => {
    const here = (await login('cfo@gpo.test', 'original-pass-phrase'))!;
    const elsewhere = (await login('cfo@gpo.test', 'original-pass-phrase'))!;

    const res = await app.inject({
      method: 'POST',
      url: '/auth/password',
      cookies: here,
      payload: { currentPassword: 'original-pass-phrase', newPassword: 'a-brand-new-pass-phrase' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, otherSessionsSignedOut: 1 });

    expect(await signedIn(here)).toBe(true);
    expect(await signedIn(elsewhere)).toBe(false);
    expect(await login('cfo@gpo.test', 'original-pass-phrase')).toBeNull();
    expect(await login('cfo@gpo.test', 'a-brand-new-pass-phrase')).not.toBeNull();

    const entry = await prisma.changeLogEntry.findFirstOrThrow({ where: { subjectType: 'User', subjectId: cfoId } });
    expect(entry).toMatchObject({ actorUserId: cfoId, reason: 'changed own password' });
    expect(JSON.stringify(entry.after)).not.toContain('$2');
  });

  it('also signs out sessions stored before the session userId column was filled in', async () => {
    const elsewhere = (await login('cfo@gpo.test', 'original-pass-phrase'))!;
    await prisma.session.updateMany({ data: { userId: null } });
    const admin = (await login('sysadmin@gpo.test', 'sysadmin-pass-phrase'))!;
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${cfoId}/password`,
      cookies: admin,
      payload: { newPassword: 'temporary-pass-phrase', reason: 'legacy session check' },
    });
    expect(res.json()).toEqual({ ok: true, sessionsSignedOut: 1 });
    expect(await signedIn(elsewhere)).toBe(false);
    expect(await signedIn(admin)).toBe(true);
  });

  it('refuses a wrong current password, a short new one, and an unchanged one', async () => {
    const cookies = (await login('cfo@gpo.test', 'original-pass-phrase'))!;
    const change = (currentPassword: string, newPassword: string) =>
      app.inject({ method: 'POST', url: '/auth/password', cookies, payload: { currentPassword, newPassword } });

    const wrong = await change('not-my-password', 'a-brand-new-pass-phrase');
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error).toMatch(/current password is incorrect/);
    expect((await change('original-pass-phrase', 'short')).statusCode).toBe(400);
    expect((await change('original-pass-phrase', 'original-pass-phrase')).statusCode).toBe(400);
    expect(await login('cfo@gpo.test', 'original-pass-phrase')).not.toBeNull();
  });

  it('requires a signed-in user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password',
      payload: { currentPassword: 'x', newPassword: 'a-brand-new-pass-phrase' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('an admin resets a password, signing out all of that user\'s sessions', async () => {
    const victimSession = (await login('cfo@gpo.test', 'original-pass-phrase'))!;
    const admin = (await login('sysadmin@gpo.test', 'sysadmin-pass-phrase'))!;
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${cfoId}/password`,
      cookies: admin,
      payload: { newPassword: 'temporary-pass-phrase', reason: 'forgot password, ticket 42' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, sessionsSignedOut: 1 });
    expect(await signedIn(victimSession)).toBe(false);
    expect(await login('cfo@gpo.test', 'temporary-pass-phrase')).not.toBeNull();

    const entry = await prisma.changeLogEntry.findFirstOrThrow({ where: { subjectType: 'User', subjectId: cfoId } });
    expect(entry).toMatchObject({ actorUserId: sysadminId, reason: 'forgot password, ticket 42' });
  });

  it('only users.administer may reset someone else\'s password', async () => {
    const cookies = (await login('cfo@gpo.test', 'original-pass-phrase'))!;
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${sysadminId}/password`,
      cookies,
      payload: { newPassword: 'hijacked-pass-phrase', reason: 'takeover' },
    });
    expect(res.statusCode).toBe(403);
    expect(await login('sysadmin@gpo.test', 'sysadmin-pass-phrase')).not.toBeNull();
  });
});
