import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { resetDb, seedBaseline, testPrisma } from '../test/db.js';

const prisma = testPrisma();
const SECRET = 'test-session-secret-at-least-32-characters-long';

describe('POST /internal/validation/run (ticket 1.7 manual trigger)', () => {
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
    app = await buildApp({ prisma, sessionSecret: SECRET });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('is sysadmin-only and runs the full registry', async () => {
    const adminLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@gpo.test', password: 'admin-pass-phrase' },
    });
    const adminCookie = adminLogin.cookies[0]!;
    const forbidden = await app.inject({
      method: 'POST',
      url: '/internal/validation/run',
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
      url: '/internal/validation/run',
      cookies: { [sysadminCookie.name]: sysadminCookie.value },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ contributionsChecked: 0 });
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'POST', url: '/internal/validation/run' });
    expect(res.statusCode).toBe(401);
  });
});
