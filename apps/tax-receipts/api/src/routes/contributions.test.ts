import { InMemoryQomon } from '@gpo/qomon-client/fake';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { withChangeLog } from '../changelog/write.js';
import { resetDb, seedBaseline, testPrisma } from '../test/db.js';

const prisma = testPrisma();
const SECRET = 'test-session-secret-at-least-32-characters-long';

describe('PATCH /contributions/:id/metadata (ticket 1.2)', () => {
  let app: FastifyInstance;
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let contributionId: string;

  const body = {
    reason: 'CFO subspace intake review',
    periodId: 67,
    ridingNumber: 84,
    entityKind: 'CA',
    receivedBy: 'ENTITY',
    goodsServices: false,
    nonDeductibleCents: 0,
    processedDate: null,
    sourceCode: 'subspace:84',
    eoContributorId: null,
    exceptionReason: null,
    externalRef: null,
  };

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    await prisma.user.update({
      where: { id: baseline.adminUserId },
      data: { passwordHash: await hashPassword('admin-pass-phrase') },
    });
    const contact = await prisma.contact.create({ data: { qomonContactId: 1n, name: 'Dana Donor' } });
    const contribution = await prisma.contribution.create({
      data: {
        qomonTransactionId: 1001n,
        qomonBundleId: 2001n,
        contactId: contact.id,
        amountCents: 5_000,
        acceptedAt: new Date('2026-03-01T00:00:00Z'),
      },
    });
    contributionId = contribution.id;
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 501 when no Qomon client is configured', async () => {
    app = await buildApp({ prisma, sessionSecret: SECRET });
    await app.ready();
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@gpo.test', password: 'admin-pass-phrase' },
    });
    const cookie = login.cookies[0]!;
    const res = await app.inject({
      method: 'PATCH',
      url: `/contributions/${contributionId}/metadata`,
      cookies: { [cookie.name]: cookie.value },
      payload: body,
    });
    expect(res.statusCode).toBe(501);
  });

  it('writes through on a valid edit by a permitted role', async () => {
    const qomon = new InMemoryQomon();
    qomon.seedBundle({ id: 2001, transactions: [{ id: 1001, contact_id: 1 }] });
    app = await buildApp({ prisma, sessionSecret: SECRET, qomon });
    await app.ready();

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@gpo.test', password: 'admin-pass-phrase' },
    });
    const cookie = login.cookies[0]!;
    const res = await app.inject({
      method: 'PATCH',
      url: `/contributions/${contributionId}/metadata`,
      cookies: { [cookie.name]: cookie.value },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ridingNumber: 84, entityKind: 'CA' });
  });

  it('rejects an edit from a role with no update permission', async () => {
    await prisma.user.create({
      data: {
        email: 'readonly@gpo.test',
        name: 'Readonly',
        role: 'readonly',
        passwordHash: await hashPassword('readonly-pass-phrase'),
        allRidings: true,
      },
    });
    app = await buildApp({ prisma, sessionSecret: SECRET, qomon: new InMemoryQomon() });
    await app.ready();

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'readonly@gpo.test', password: 'readonly-pass-phrase' },
    });
    const cookie = login.cookies[0]!;
    const res = await app.inject({
      method: 'PATCH',
      url: `/contributions/${contributionId}/metadata`,
      cookies: { [cookie.name]: cookie.value },
      payload: body,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /contributions (ticket 1.3)', () => {
  let app: FastifyInstance;
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    await prisma.user.update({
      where: { id: baseline.adminUserId },
      data: { passwordHash: await hashPassword('admin-pass-phrase') },
    });
    app = await buildApp({ prisma, sessionSecret: SECRET });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/contributions' });
    expect(res.statusCode).toBe(401);
  });

  it('lists mirrored contributions for an authenticated user, filterable by query params', async () => {
    const contact = await prisma.contact.create({ data: { qomonContactId: 99n, name: 'Dana Donor' } });
    await prisma.contribution.create({
      data: { contactId: contact.id, qomonTransactionId: 99n, amountCents: 1_000, acceptedAt: new Date('2026-03-01T00:00:00Z') },
    });

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@gpo.test', password: 'admin-pass-phrase' },
    });
    const cookie = login.cookies[0]!;

    const all = await app.inject({ method: 'GET', url: '/contributions', cookies: { [cookie.name]: cookie.value } });
    expect(all.statusCode).toBe(200);
    expect(all.json().data).toHaveLength(1);

    const filtered = await app.inject({
      method: 'GET',
      url: '/contributions?minAmountCents=5000',
      cookies: { [cookie.name]: cookie.value },
    });
    expect(filtered.json().data).toHaveLength(0);
  });
});

describe('POST /contributions/bulk-edit (ticket 1.4)', () => {
  let app: FastifyInstance;
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let contributionId: string;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    await prisma.user.update({
      where: { id: baseline.adminUserId },
      data: { passwordHash: await hashPassword('admin-pass-phrase') },
    });
    const contact = await prisma.contact.create({ data: { qomonContactId: 500n, name: 'Dana Donor' } });
    const contribution = await prisma.contribution.create({
      data: {
        qomonTransactionId: 501n,
        qomonBundleId: 502n,
        contactId: contact.id,
        amountCents: 5_000,
        acceptedAt: new Date('2026-03-01T00:00:00Z'),
      },
    });
    await withChangeLog(prisma, { userId: null, reason: 'fixture' }, async (ctx) => {
      const after = await ctx.tx.contributionMetadata.create({
        data: { contributionId: contribution.id, periodId: baseline.periodId, entityKind: 'PARTY', receivedBy: 'GPO' },
      });
      await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contribution.id, after });
    });
    contributionId = contribution.id;
  });

  afterEach(async () => {
    await app.close();
  });

  it('applies a bulk edit end to end through the HTTP layer', async () => {
    const qomon = new InMemoryQomon();
    qomon.seedBundle({ id: 502, transactions: [{ id: 501, contact_id: 500 }] });
    app = await buildApp({ prisma, sessionSecret: SECRET, qomon });
    await app.ready();

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@gpo.test', password: 'admin-pass-phrase' },
    });
    const cookie = login.cookies[0]!;
    const res = await app.inject({
      method: 'POST',
      url: '/contributions/bulk-edit',
      cookies: { [cookie.name]: cookie.value },
      payload: {
        reason: 'reassign for the by-election',
        contributionIds: [contributionId],
        changes: { periodId: 67 },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ succeeded: 1, failed: 0 });
  });

  it('rejects an empty changes body at the schema level', async () => {
    app = await buildApp({ prisma, sessionSecret: SECRET, qomon: new InMemoryQomon() });
    await app.ready();
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@gpo.test', password: 'admin-pass-phrase' },
    });
    const cookie = login.cookies[0]!;
    const res = await app.inject({
      method: 'POST',
      url: '/contributions/bulk-edit',
      cookies: { [cookie.name]: cookie.value },
      payload: { reason: 'x', contributionIds: [contributionId], changes: {} },
    });
    expect(res.statusCode).toBe(400);
  });
});
