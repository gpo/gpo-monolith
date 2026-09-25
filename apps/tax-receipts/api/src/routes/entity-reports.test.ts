import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { withChangeLog } from '../changelog/write.js';
import { issueReceipt as fixtureIssueReceipt, resetDb, seedBaseline, testPrisma, createTestContribution } from '../test/db.js';

const prisma = testPrisma();
const SECRET = 'test-session-secret-at-least-32-characters-long';

describe('entity report routes (ticket 4.5)', () => {
  let app: FastifyInstance;
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let storageDir: string;
  let contributionId: string;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    await prisma.user.update({
      where: { id: baseline.cfoUserId },
      data: { passwordHash: await hashPassword('cfo-pass-phrase') },
    });
    await prisma.user.update({
      where: { id: baseline.adminUserId },
      data: { passwordHash: await hashPassword('admin-pass-phrase') },
    });

    const contact = await prisma.contact.create({
      data: {
        qomonContactId: 1n,
        name: 'Dana Donor',
        firstName: 'Dana',
        lastName: 'Donor',
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
    await fixtureIssueReceipt(prisma, {
      contactId: contact.id,
      contributionId,
      periodId: baseline.periodId,
      amountCents: 5_000,
      actorUserId: baseline.cfoUserId,
      entityKind: 'PARTY',
    });

    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-entity-report-routes-test-'));
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

  it('requires authentication to list', async () => {
    const res = await app.inject({ method: 'GET', url: `/periods/${baseline.periodId}/entity-reports` });
    expect(res.statusCode).toBe(401);
  });

  it('403s an administrator generating a report (only party CFO / bookkeeper / filer / designate)', async () => {
    const cookie = await login('admin@gpo.test', 'admin-pass-phrase');
    const res = await app.inject({
      method: 'POST',
      url: `/periods/${baseline.periodId}/entity-reports`,
      cookies: { [cookie.name]: cookie.value },
      payload: {
        kind: 'ALL',
        entityKind: 'PARTY',
        ridingNumber: null,
        politicalEntityLabel: 'Green Party of Ontario',
        reason: 'generate',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets the party CFO generate, list, fetch, and download an ALL report', async () => {
    const cookie = await login('cfo@gpo.test', 'cfo-pass-phrase');

    const generate = await app.inject({
      method: 'POST',
      url: `/periods/${baseline.periodId}/entity-reports`,
      cookies: { [cookie.name]: cookie.value },
      payload: {
        kind: 'ALL',
        entityKind: 'PARTY',
        ridingNumber: null,
        politicalEntityLabel: 'Green Party of Ontario',
        reason: 'generate ALL report',
      },
    });
    expect(generate.statusCode).toBe(201);
    const { entityReportId } = generate.json();
    expect(entityReportId).toBeTruthy();

    const list = await app.inject({
      method: 'GET',
      url: `/periods/${baseline.periodId}/entity-reports`,
      cookies: { [cookie.name]: cookie.value },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toMatchObject([{ id: entityReportId, kind: 'ALL', dirty: false, rowCount: 1 }]);

    const detail = await app.inject({
      method: 'GET',
      url: `/entity-reports/${entityReportId}`,
      cookies: { [cookie.name]: cookie.value },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().drift.status).toBe('clean');

    const csv = await app.inject({
      method: 'GET',
      url: `/entity-reports/${entityReportId}/csv`,
      cookies: { [cookie.name]: cookie.value },
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('Green Party of Ontario');
  });

  it('404s a nonexistent entity report', async () => {
    const cookie = await login('cfo@gpo.test', 'cfo-pass-phrase');
    const res = await app.inject({
      method: 'GET',
      url: '/entity-reports/does-not-exist',
      cookies: { [cookie.name]: cookie.value },
    });
    expect(res.statusCode).toBe(404);
  });

  it('409s generation blocked by the REP4/REP6 export gate, surfacing named findings', async () => {
    // CAMPAIGN during the ANNUAL baseline period is never a valid entity (REP4).
    const cookie = await login('cfo@gpo.test', 'cfo-pass-phrase');
    await prisma.riding.create({ data: { ridingNumber: 84, name: 'Parry Sound-Muskoka', qomonApiKey: 'x' } });
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contributionMetadata.create({
        data: {
          contributionId: (
            await createTestContribution(prisma, { qomonTransactionId: 2n, contactId: (await prisma.contact.findFirstOrThrow()).id, amountCents: 1_000, acceptedAt: new Date('2026-03-01T12:00:00Z') })
          ).id,
          periodId: baseline.periodId,
          entityKind: 'CAMPAIGN',
          ridingNumber: 84,
          receivedBy: 'GPO',
        },
      });
      await ctx.log({ subjectType: 'ContributionMetadata', subjectId: after.contributionId, after });
    });
    // Issue the campaign receipt directly (bypassing the request path) so
    // its receiptNumber sequences after the fixture's.
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed receipt' }, async (ctx) => {
      const snapshot = await ctx.tx.addressSnapshot.create({
        data: { contactId: (await prisma.contact.findFirstOrThrow()).id, periodId: baseline.periodId, line1: '1 Main St', city: 'Toronto', province: 'ON', postalCode: 'M1M1M1', source: 'test' },
      });
      const seq = await ctx.tx.receiptSequence.update({ where: { prefix: 'GPO-' }, data: { counter: { increment: 1 } } });
      const receipt = await ctx.tx.receipt.create({
        data: {
          receiptNumber: `GPO-${String(seq.counter).padStart(8, '0')}`,
          entityKind: 'CAMPAIGN',
          ridingNumber: 84,
          periodId: baseline.periodId,
          issueDate: new Date(),
          contactId: (await prisma.contact.findFirstOrThrow()).id,
          contactNameSnapshot: 'Dana Donor',
          addressSnapshotId: snapshot.id,
        },
      });
      const contributionMeta = await prisma.contributionMetadata.findFirstOrThrow({ where: { entityKind: 'CAMPAIGN' } });
      const allocation = await ctx.tx.receiptAllocation.create({
        data: { receiptId: receipt.id, contributionId: contributionMeta.contributionId, amountCents: 1_000 },
      });
      await ctx.log({ subjectType: 'Receipt', subjectId: receipt.id, after: receipt });
      await ctx.log({ subjectType: 'ReceiptAllocation', subjectId: allocation.id, after: allocation });
    });

    const res = await app.inject({
      method: 'POST',
      url: `/periods/${baseline.periodId}/entity-reports`,
      cookies: { [cookie.name]: cookie.value },
      payload: {
        kind: 'ALL',
        entityKind: 'CAMPAIGN',
        ridingNumber: 84,
        politicalEntityLabel: 'Some Campaign',
        reason: 'generate',
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().findings).toHaveLength(1);
    expect(res.json().findings[0].ruleRef).toBe('REP4');
    void contributionId;
  });

  it('lets the party CFO mark a report sent to the CFO', async () => {
    const cookie = await login('cfo@gpo.test', 'cfo-pass-phrase');
    const generate = await app.inject({
      method: 'POST',
      url: `/periods/${baseline.periodId}/entity-reports`,
      cookies: { [cookie.name]: cookie.value },
      payload: {
        kind: 'ALL',
        entityKind: 'PARTY',
        ridingNumber: null,
        politicalEntityLabel: 'Green Party of Ontario',
        reason: 'generate',
      },
    });
    const { entityReportId } = generate.json();

    const sent = await app.inject({
      method: 'POST',
      url: `/entity-reports/${entityReportId}/sent-to-cfo`,
      cookies: { [cookie.name]: cookie.value },
      payload: { reason: 'emailed to Mike' },
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().sentToCfoAt).not.toBeNull();
  });
});
