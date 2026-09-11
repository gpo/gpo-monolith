import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { resetDb, seedBaseline, testPrisma } from '../test/db.js';

const prisma = testPrisma();
const SECRET = 'test-session-secret-at-least-32-characters-long';

describe('admin routes (ticket 1.12)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb(prisma);
    const baseline = await seedBaseline(prisma);
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

  async function login(email: string, password: string) {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    return res.cookies[0]!;
  }

  it('rejects an administrator (non-sysadmin) from writing periods, but allows reading', async () => {
    const cookie = await login('admin@gpo.test', 'admin-pass-phrase');
    const read = await app.inject({ method: 'GET', url: '/admin/periods', cookies: { [cookie.name]: cookie.value } });
    expect(read.statusCode).toBe(200);

    const write = await app.inject({
      method: 'PUT',
      url: '/admin/periods/2020',
      cookies: { [cookie.name]: cookie.value },
      payload: { name: '2020 Annual', kind: 'ANNUAL', startsAt: '2020-01-01T05:00:00Z', endsAt: '2021-01-01T05:00:00Z' },
    });
    expect(write.statusCode).toBe(403);
  });

  it('a sysadmin can create a period, which re-runs validation', async () => {
    const cookie = await login('sysadmin@gpo.test', 'sysadmin-pass-phrase');
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/periods/2020',
      cookies: { [cookie.name]: cookie.value },
      payload: { name: '2020 Annual', kind: 'ANNUAL', startsAt: '2020-01-01T05:00:00Z', endsAt: '2021-01-01T05:00:00Z' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().period).toMatchObject({ id: 2020, name: '2020 Annual' });
    expect(res.json().revalidation).toMatchObject({ contributionsChecked: 0 });
    expect(await prisma.period.findUnique({ where: { id: 2020 } })).not.toBeNull();
  });

  it('a sysadmin can upsert and delete a contribution limit', async () => {
    const cookie = await login('sysadmin@gpo.test', 'sysadmin-pass-phrase');
    const put = await app.inject({
      method: 'PUT',
      url: '/admin/contribution-limits',
      cookies: { [cookie.name]: cookie.value },
      payload: { year: 2027, bucket: 'PARTY', amountCents: 500_000 },
    });
    expect(put.statusCode).toBe(200);
    const id = put.json().id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/admin/contribution-limits/${id}`,
      cookies: { [cookie.name]: cookie.value },
    });
    expect(del.statusCode).toBe(204);
    expect(await prisma.contributionLimit.findUnique({ where: { id } })).toBeNull();
  });

  it('a sysadmin can set a business-day calendar', async () => {
    const cookie = await login('sysadmin@gpo.test', 'sysadmin-pass-phrase');
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/business-day-calendars/2028',
      cookies: { [cookie.name]: cookie.value },
      payload: { holidays: ['2028-01-01', '2028-07-01'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().holidays).toEqual(['2028-01-01', '2028-07-01']);
  });

  it('a sysadmin can create and update a user', async () => {
    const cookie = await login('sysadmin@gpo.test', 'sysadmin-pass-phrase');
    const create = await app.inject({
      method: 'POST',
      url: '/admin/users',
      cookies: { [cookie.name]: cookie.value },
      payload: {
        name: 'New Filer',
        email: 'new-filer@gpo.test',
        password: 'a-long-enough-password',
        role: 'filer',
      },
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().id;

    const update = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${id}`,
      cookies: { [cookie.name]: cookie.value },
      payload: { isCfoDesignate: true, ridingGrants: [84] },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({ isCfoDesignate: true, ridingGrants: [84] });
  });

  it('requires authentication for every admin GET route', async () => {
    for (const url of ['/admin/periods', '/admin/contribution-limits', '/admin/business-day-calendars', '/admin/users']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(401);
    }
  });
});
