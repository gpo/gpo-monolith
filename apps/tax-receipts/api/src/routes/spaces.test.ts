import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { withChangeLog } from '../changelog/write.js';
import { resetDb, seedBaseline, testPrisma } from '../test/db.js';

const prisma = testPrisma();
const SECRET = 'test-session-secret-at-least-32-characters-long';

describe('GET /spaces (ticket 1.10)', () => {
  let app: FastifyInstance;
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    await prisma.user.update({
      where: { id: baseline.adminUserId },
      data: { passwordHash: await hashPassword('admin-pass-phrase') },
    });
    const contact = await prisma.contact.create({ data: { qomonContactId: 1n, name: 'Dana Donor' } });
    const contribution = await prisma.contribution.create({
      data: { contactId: contact.id, qomonTransactionId: 1n, amountCents: 1_000, acceptedAt: new Date('2026-03-01T00:00:00Z') },
    });
    await withChangeLog(prisma, { userId: null, reason: 'fixture' }, async (ctx) => {
      const after = await ctx.tx.contributionMetadata.create({
        data: { contributionId: contribution.id, periodId: baseline.periodId, ridingNumber: 84, entityKind: 'CA', receivedBy: 'GPO' },
      });
      await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contribution.id, after });
    });
    app = await buildApp({ prisma, sessionSecret: SECRET });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/spaces' });
    expect(res.statusCode).toBe(401);
  });

  it('returns the derived space grid', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@gpo.test', password: 'admin-pass-phrase' },
    });
    const cookie = login.cookies[0]!;
    const res = await app.inject({ method: 'GET', url: '/spaces', cookies: { [cookie.name]: cookie.value } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject([{ ridingNumber: 84, entityKind: 'CA', stage: 'intake', contributionCount: 1 }]);
  });
});
