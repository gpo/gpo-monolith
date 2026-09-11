import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { resetDb, seedBaseline, testPrisma } from '../test/db.js';

const prisma = testPrisma();
const SECRET = 'test-session-secret-at-least-32-characters-long';

describe('work queue routes (ticket 1.8)', () => {
  let app: FastifyInstance;
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let itemId: string;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    await prisma.user.update({
      where: { id: baseline.adminUserId },
      data: { passwordHash: await hashPassword('admin-pass-phrase') },
    });
    const contact = await prisma.contact.create({ data: { qomonContactId: 1n, name: 'Dana Donor' } });
    const item = await prisma.workItem.create({
      data: { kind: 'VALIDATION', subjectType: 'Contribution', subjectId: 'c1', contactId: contact.id, ruleRef: 'A8' },
    });
    itemId = item.id;
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

  it('requires authentication to list', async () => {
    const res = await app.inject({ method: 'GET', url: '/work-items' });
    expect(res.statusCode).toBe(401);
  });

  it('lists work items filterable by kind', async () => {
    const cookie = await login();
    const res = await app.inject({
      method: 'GET',
      url: '/work-items?kind=VALIDATION',
      cookies: { [cookie.name]: cookie.value },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it('resolves a work item with a reason', async () => {
    const cookie = await login();
    const res = await app.inject({
      method: 'POST',
      url: `/work-items/${itemId}/resolve`,
      cookies: { [cookie.name]: cookie.value },
      payload: { reason: 'fixed the payment method', outcome: 'RESOLVED' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('RESOLVED');
  });

  it('rejects resolving an already-closed item', async () => {
    const cookie = await login();
    await app.inject({
      method: 'POST',
      url: `/work-items/${itemId}/resolve`,
      cookies: { [cookie.name]: cookie.value },
      payload: { reason: 'first', outcome: 'RESOLVED' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/work-items/${itemId}/resolve`,
      cookies: { [cookie.name]: cookie.value },
      payload: { reason: 'second', outcome: 'RESOLVED' },
    });
    expect(res.statusCode).toBe(409);
  });
});
