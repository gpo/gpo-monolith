import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { withChangeLog } from '../changelog/write.js';
import { resetDb, seedBaseline, testPrisma, createTestContribution } from '../test/db.js';

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
    const contribution = await createTestContribution(prisma, {
        qomonTransactionId: 1n,
        contactId: contact.id,
        amountCents: 5_000,
        acceptedAt: new Date('2026-03-01T12:00:00Z'),
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

  it('lets the party CFO record a foreign receipt number, with no PDF to fetch', async () => {
    const cookie = await login('cfo@gpo.test', 'cfo-pass-phrase');
    const res = await app.inject({
      method: 'POST',
      url: `/contributions/${contributionId}/receipts/foreign`,
      cookies: { [cookie.name]: cookie.value },
      payload: { reason: 'EO-stock book #4, slip 12', receiptNumber: 'EOSTOCK-000412' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.receiptNumber).toBe('EOSTOCK-000412');

    const pdf = await app.inject({
      method: 'GET',
      url: `/receipts/${body.id}/pdf`,
      cookies: { [cookie.name]: cookie.value },
    });
    expect(pdf.statusCode).toBe(404);
  });

  it('403s an administrator recording a foreign receipt: only the party CFO (or a designate) may issue', async () => {
    const cookie = await login('admin@gpo.test', 'admin-pass-phrase');
    const res = await app.inject({
      method: 'POST',
      url: `/contributions/${contributionId}/receipts/foreign`,
      cookies: { [cookie.name]: cookie.value },
      payload: { reason: 'not allowed', receiptNumber: 'EOSTOCK-1' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('400s a foreign receipt number that looks like the tool\'s own sequence format', async () => {
    const cookie = await login('cfo@gpo.test', 'cfo-pass-phrase');
    const res = await app.inject({
      method: 'POST',
      url: `/contributions/${contributionId}/receipts/foreign`,
      cookies: { [cookie.name]: cookie.value },
      payload: { reason: 'mistaken format', receiptNumber: 'GPO-00000001' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('receipt allocation route (ticket 3.2)', () => {
  let app: FastifyInstance;
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let storageDir: string;
  let receiptId: string;
  let secondContributionId: string;

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
    await prisma.user.create({
      data: {
        email: 'bookkeeper@gpo.test',
        name: 'Bookkeeper',
        role: 'bookkeeper',
        passwordHash: await hashPassword('bookkeeper-pass-phrase'),
        allRidings: true,
      },
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
    const firstContribution = await createTestContribution(prisma, { qomonTransactionId: 1n, contactId: contact.id, amountCents: 5_000, acceptedAt: new Date('2026-03-01T12:00:00Z') });
    const secondContribution = await createTestContribution(prisma, { qomonTransactionId: 2n, contactId: contact.id, amountCents: 3_000, acceptedAt: new Date('2026-03-05T12:00:00Z') });
    secondContributionId = secondContribution.id;
    for (const contributionId of [firstContribution.id, secondContribution.id]) {
      await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
        const after = await ctx.tx.contributionMetadata.create({
          data: { contributionId, periodId: baseline.periodId, entityKind: 'PARTY', receivedBy: 'GPO' },
        });
        await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contributionId, after });
      });
    }

    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-receipts-allocate-test-'));
    app = await buildApp({ prisma, sessionSecret: SECRET, artifactStorageDir: storageDir });
    await app.ready();

    const cookie = await login('cfo@gpo.test', 'cfo-pass-phrase');
    const issued = await app.inject({
      method: 'POST',
      url: `/contributions/${firstContribution.id}/receipts`,
      cookies: { [cookie.name]: cookie.value },
      payload: { reason: 'first receipt', politicalEntityLabel: 'Green Party of Ontario' },
    });
    receiptId = issued.json().id;
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
      url: `/receipts/${receiptId}/allocations`,
      payload: { contributionId: secondContributionId, reason: 'no session' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403s a role with no correct ability on Receipt', async () => {
    const cookie = await login('bookkeeper@gpo.test', 'bookkeeper-pass-phrase');
    const res = await app.inject({
      method: 'POST',
      url: `/receipts/${receiptId}/allocations`,
      cookies: { [cookie.name]: cookie.value },
      payload: { contributionId: secondContributionId, reason: 'not allowed' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets an administrator (who may correct but not issue) attach a second contribution', async () => {
    const cookie = await login('admin@gpo.test', 'admin-pass-phrase');
    const res = await app.inject({
      method: 'POST',
      url: `/receipts/${receiptId}/allocations`,
      cookies: { [cookie.name]: cookie.value },
      payload: { contributionId: secondContributionId, reason: 'consolidate' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.amountCents).toBe(3_000);
    expect(body.receiptTotalCents).toBe(8_000);
  });

  it('409s a duplicate allocation of the same contribution', async () => {
    const cookie = await login('cfo@gpo.test', 'cfo-pass-phrase');
    await app.inject({
      method: 'POST',
      url: `/receipts/${receiptId}/allocations`,
      cookies: { [cookie.name]: cookie.value },
      payload: { contributionId: secondContributionId, reason: 'first attach' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/receipts/${receiptId}/allocations`,
      cookies: { [cookie.name]: cookie.value },
      payload: { contributionId: secondContributionId, reason: 'duplicate attach' },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('receipt correction routes: cancel / reissue (ticket 3.10)', () => {
  let app: FastifyInstance;
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let storageDir: string;
  let receiptId: string;

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
    await prisma.user.create({
      data: {
        email: 'bookkeeper@gpo.test',
        name: 'Bookkeeper',
        role: 'bookkeeper',
        passwordHash: await hashPassword('bookkeeper-pass-phrase'),
        allRidings: true,
      },
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
    const contribution = await createTestContribution(prisma, { qomonTransactionId: 1n, contactId: contact.id, amountCents: 5_000, acceptedAt: new Date('2026-03-01T12:00:00Z') });
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contributionMetadata.create({
        data: { contributionId: contribution.id, periodId: baseline.periodId, entityKind: 'PARTY', receivedBy: 'GPO' },
      });
      await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contribution.id, after });
    });

    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-receipts-correction-test-'));
    app = await buildApp({ prisma, sessionSecret: SECRET, artifactStorageDir: storageDir });
    await app.ready();

    const cookie = await login('cfo@gpo.test', 'cfo-pass-phrase');
    const issued = await app.inject({
      method: 'POST',
      url: `/contributions/${contribution.id}/receipts`,
      cookies: { [cookie.name]: cookie.value },
      payload: { reason: 'first receipt', politicalEntityLabel: 'Green Party of Ontario' },
    });
    receiptId = issued.json().id;
  });

  afterEach(async () => {
    await app.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  async function login(email: string, password: string) {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    return res.cookies[0]!;
  }

  it('requires authentication for the preview, cancel, and reissue routes', async () => {
    for (const call of [
      { method: 'GET' as const, url: `/receipts/${receiptId}/correction-preview` },
      { method: 'POST' as const, url: `/receipts/${receiptId}/cancel`, payload: { reason: 'no session' } },
      { method: 'POST' as const, url: `/receipts/${receiptId}/reissue`, payload: { reason: 'no session', politicalEntityLabel: 'GPO' } },
    ]) {
      const res = await app.inject(call);
      expect(res.statusCode).toBe(401);
    }
  });

  it('lets any authenticated user see the correction preview (read is granted broadly)', async () => {
    const cookie = await login('bookkeeper@gpo.test', 'bookkeeper-pass-phrase');
    const res = await app.inject({
      method: 'GET',
      url: `/receipts/${receiptId}/correction-preview`,
      cookies: { [cookie.name]: cookie.value },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ receiptNumber: 'GPO-00402510', totalAmountCents: 5_000, owedToEoCount: 0 });
  });

  it('403s a role with no correct ability on Receipt for cancel and reissue', async () => {
    const cookie = await login('bookkeeper@gpo.test', 'bookkeeper-pass-phrase');
    const cancel = await app.inject({
      method: 'POST',
      url: `/receipts/${receiptId}/cancel`,
      cookies: { [cookie.name]: cookie.value },
      payload: { reason: 'not allowed' },
    });
    expect(cancel.statusCode).toBe(403);

    const reissue = await app.inject({
      method: 'POST',
      url: `/receipts/${receiptId}/reissue`,
      cookies: { [cookie.name]: cookie.value },
      payload: { reason: 'not allowed', politicalEntityLabel: 'GPO' },
    });
    expect(reissue.statusCode).toBe(403);
  });

  it('lets an administrator cancel a receipt', async () => {
    const cookie = await login('admin@gpo.test', 'admin-pass-phrase');
    const res = await app.inject({
      method: 'POST',
      url: `/receipts/${receiptId}/cancel`,
      cookies: { [cookie.name]: cookie.value },
      payload: { reason: 'donor ineligible' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().owedToEoWorkItemIds).toEqual([]);

    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } });
    expect(receipt.status).toBe('CANCELLED');
  });

  it('lets the party CFO reissue a receipt, taking the next sequence number', async () => {
    const cookie = await login('cfo@gpo.test', 'cfo-pass-phrase');
    const res = await app.inject({
      method: 'POST',
      url: `/receipts/${receiptId}/reissue`,
      cookies: { [cookie.name]: cookie.value },
      payload: { reason: 'address fix', politicalEntityLabel: 'Green Party of Ontario' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.newReceiptNumber).toBe('GPO-00402511');
    expect(body.cancelledReceiptId).toBe(receiptId);
  });
});
