import { InMemoryQomon } from '@gpo/qomon-client/fake';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { resetDb, seedBaseline, testPrisma } from '../test/db.js';

const prisma = testPrisma();
const SECRET = 'test-session-secret-at-least-32-characters-long';

describe('POST /internal/sync/sweep (ticket 1.1 manual trigger)', () => {
  let app: FastifyInstance;
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    await prisma.user.update({
      where: { id: baseline.adminUserId },
      data: { passwordHash: await hashPassword('admin-pass-phrase') },
    });
    await prisma.user.create({
      data: {
        email: 'sysadmin@gpo.test',
        name: 'Sys Admin',
        role: 'sysadmin',
        passwordHash: await hashPassword('sysadmin-pass-phrase'),
        allRidings: true,
      },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('does not exist when no Qomon client is configured', async () => {
    app = await buildApp({ prisma, sessionSecret: SECRET });
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/internal/sync/sweep' });
    expect(res.statusCode).toBe(404);
  });

  it('is sysadmin-only and runs a sweep when configured', async () => {
    app = await buildApp({ prisma, sessionSecret: SECRET, qomon: new InMemoryQomon() });
    await app.ready();

    const adminLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@gpo.test', password: 'admin-pass-phrase' },
    });
    const adminCookie = adminLogin.cookies[0]!;
    const forbidden = await app.inject({
      method: 'POST',
      url: '/internal/sync/sweep',
      cookies: { [adminCookie.name]: adminCookie.value },
    });
    expect(forbidden.statusCode).toBe(403);

    const sysadminLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'sysadmin@gpo.test', password: 'sysadmin-pass-phrase' },
    });
    const sysadminCookie = sysadminLogin.cookies[0]!;
    const ok = await app.inject({
      method: 'POST',
      url: '/internal/sync/sweep',
      cookies: { [sysadminCookie.name]: sysadminCookie.value },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ mode: 'incremental', pulled: 0 });
  });
});
