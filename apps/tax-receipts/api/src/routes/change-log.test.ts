import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { withChangeLog } from '../changelog/write.js';
import { resetDb, seedBaseline, testPrisma } from '../test/db.js';

const prisma = testPrisma();
const SECRET = 'test-session-secret-at-least-32-characters-long';

describe('change-log explorer routes (ticket 1.11)', () => {
  let app: FastifyInstance;
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    await prisma.user.update({
      where: { id: baseline.adminUserId },
      data: { passwordHash: await hashPassword('admin-pass-phrase') },
    });
    await withChangeLog(prisma, { userId: baseline.adminUserId, reason: 'fixture' }, async (ctx) => {
      const item = await ctx.tx.workItem.create({
        data: { kind: 'VALIDATION', subjectType: 'Contribution', subjectId: 'c1', ruleRef: 'A8' },
      });
      await ctx.log({ subjectType: 'WorkItem', subjectId: item.id, after: item });
    });
    app = await buildApp({ prisma, sessionSecret: SECRET });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function login() {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@gpo.test', password: 'admin-pass-phrase' },
    });
    return res.cookies[0]!;
  }

  it('requires authentication', async () => {
    expect((await app.inject({ method: 'GET', url: '/change-log' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/change-log/export' })).statusCode).toBe(401);
  });

  it('lists entries', async () => {
    const cookie = await login();
    const res = await app.inject({ method: 'GET', url: '/change-log', cookies: { [cookie.name]: cookie.value } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThanOrEqual(1);
  });

  it('exports CSV with the right content type', async () => {
    const cookie = await login();
    const res = await app.inject({
      method: 'GET',
      url: '/change-log/export',
      cookies: { [cookie.name]: cookie.value },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('"at","subjectType"');
  });
});
