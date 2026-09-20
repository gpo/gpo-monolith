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

describe('per-space issuance routes (ticket 3.12)', () => {
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

    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-space-routes-test-'));
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

  it('requires authentication for the preview', async () => {
    const res = await app.inject({ method: 'GET', url: `/spaces/${baseline.periodId}/PARTY/issuance-preview` });
    expect(res.statusCode).toBe(401);
  });

  it('lets any authenticated user preview a space (read is granted broadly)', async () => {
    const cookie = await login('admin@gpo.test', 'admin-pass-phrase');
    const res = await app.inject({
      method: 'GET',
      url: `/spaces/${baseline.periodId}/PARTY/issuance-preview`,
      cookies: { [cookie.name]: cookie.value },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.blocked).toBe(false);
    expect(body.totals).toEqual({ receiptCount: 1, amountCents: 5_000, emailCount: 0, mailCount: 1 });
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0].contributionId).toBe(contributionId);
  });

  it('403s an administrator trying to generate: only the party CFO (or a designate) may issue', async () => {
    const cookie = await login('admin@gpo.test', 'admin-pass-phrase');
    const res = await app.inject({
      method: 'POST',
      url: `/spaces/${baseline.periodId}/PARTY/receipts`,
      cookies: { [cookie.name]: cookie.value },
      payload: { reason: 'not allowed', politicalEntityLabel: 'Green Party of Ontario' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets the party CFO generate receipts for the whole space', async () => {
    const cookie = await login('cfo@gpo.test', 'cfo-pass-phrase');
    const res = await app.inject({
      method: 'POST',
      url: `/spaces/${baseline.periodId}/PARTY/receipts`,
      cookies: { [cookie.name]: cookie.value },
      payload: { reason: 'space issuance', politicalEntityLabel: 'Green Party of Ontario' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.results[0].receiptNumber).toBe('GPO-00402510');
  });

  it('409s generation while an open work item blocks the space', async () => {
    await prisma.workItem.create({
      data: {
        kind: 'VALIDATION',
        subjectType: 'Contribution',
        subjectId: contributionId,
        ruleRef: 'B2',
      },
    });
    const cookie = await login('cfo@gpo.test', 'cfo-pass-phrase');
    const res = await app.inject({
      method: 'POST',
      url: `/spaces/${baseline.periodId}/PARTY/receipts`,
      cookies: { [cookie.name]: cookie.value },
      payload: { reason: 'should be blocked', politicalEntityLabel: 'Green Party of Ontario' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().blockers).toHaveLength(1);
  });

  it('403s a riding-scoped user asking about a riding outside their grant', async () => {
    await prisma.user.create({
      data: {
        email: 'scoped@gpo.test',
        name: 'Scoped Reader',
        role: 'readonly',
        passwordHash: await hashPassword('scoped-pass-phrase'),
        allRidings: false,
        ridingGrants: [1],
      },
    });
    const cookie = await login('scoped@gpo.test', 'scoped-pass-phrase');
    const res = await app.inject({
      method: 'GET',
      url: `/spaces/${baseline.periodId}/CA/issuance-preview?ridingNumber=84`,
      cookies: { [cookie.name]: cookie.value },
    });
    expect(res.statusCode).toBe(403);
  });
});
