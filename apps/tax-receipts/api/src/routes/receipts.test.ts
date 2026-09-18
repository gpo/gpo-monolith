import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { withChangeLog } from '../changelog/write.js';
import { resetDb, seedBaseline, testPrisma } from '../test/db.js';

const prisma = testPrisma();
const SECRET = 'test-session-secret-at-least-32-characters-long';

describe('receipt routes (ticket 3.1)', () => {
  let app: FastifyInstance;
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let storageDir: string;
  let contributionId: string;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    await prisma.user.update({
      where: { id: baseline.adminUserId },
      data: { passwordHash: await hashPassword('admin-pass-phrase') },
    });
    await prisma.user.update({
      where: { id: baseline.cfoUserId },
      data: { passwordHash: await hashPassword('cfo-pass-phrase') },
    });

    const contact = await prisma.contact.create({
      data: {
        qomonContactId: 1n,
        name: 'Dana Donor',
        addresses: [
          { housenumber: '1', street: 'Main St', city: 'Toronto', state: 'ON', postalcode: 'M1M1M1', country: 'CA' },
        ],
      },
    });
    const contribution = await prisma.contribution.create({
      data: {
        qomonTransactionId: 1n,
        contactId: contact.id,
        amountCents: 5_000,
        acceptedAt: new Date('2026-03-01T12:00:00Z'),
      },
    });
    contributionId = contribution.id;
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contributionMetadata.create({
        data: { contributionId, periodId: baseline.periodId, entityKind: 'PARTY', receivedBy: 'GPO' },
      });
      await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contributionId, after });
    });

    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-receipts-route-test-'));
    app = await buildApp({ prisma, sessionSecret: SECRET, artifactStorageDir: storageDir });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  async function login(email: string, password: string) {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    return res.cookies[0]!;
  }

  it('requires authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/contributions/${contributionId}/receipts`,
      payload: { reason: 'no session', politicalEntityLabel: 'Green Party of Ontario' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403s an administrator: only the party CFO (or a designate) may issue', async () => {
    const cookie = await login('admin@gpo.test', 'admin-pass-phrase');
    const res = await app.inject({
      method: 'POST',
      url: `/contributions/${contributionId}/receipts`,
      cookies: { [cookie.name]: cookie.value },
      payload: { reason: 'not allowed', politicalEntityLabel: 'Green Party of Ontario' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets the party CFO issue a receipt and fetch its PDF', async () => {
    const cookie = await login('cfo@gpo.test', 'cfo-pass-phrase');
    const issued = await app.inject({
      method: 'POST',
      url: `/contributions/${contributionId}/receipts`,
      cookies: { [cookie.name]: cookie.value },
      payload: { reason: 'annual receipt', politicalEntityLabel: 'Green Party of Ontario' },
    });
    expect(issued.statusCode).toBe(201);
    const body = issued.json();
    expect(body.receiptNumber).toBe('GPO-00402510');

    const pdf = await app.inject({
      method: 'GET',
      url: `/receipts/${body.id}/pdf`,
      cookies: { [cookie.name]: cookie.value },
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });

  it('423s while the kill switch is engaged', async () => {
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'EO request' }, async (ctx) => {
      await ctx.tx.issuanceKillSwitch.update({
        where: { id: 'singleton' },
        data: { engaged: true, engagedAt: new Date(), engagedBy: baseline.cfoUserId, reason: 'EO request' },
      });
      await ctx.log({ subjectType: 'IssuanceKillSwitch', subjectId: 'singleton' });
    });

    const cookie = await login('cfo@gpo.test', 'cfo-pass-phrase');
    const res = await app.inject({
      method: 'POST',
      url: `/contributions/${contributionId}/receipts`,
      cookies: { [cookie.name]: cookie.value },
      payload: { reason: 'blocked', politicalEntityLabel: 'Green Party of Ontario' },
    });
    expect(res.statusCode).toBe(423);
  });
});
