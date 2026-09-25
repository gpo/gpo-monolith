import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { withChangeLog } from '../changelog/write.js';
import { issueReceipt } from '../receipts/issue.js';
import { createTestContribution, resetDb, seedBaseline, testPrisma } from '../test/db.js';

const prisma = testPrisma();
const SECRET = 'test-session-secret-at-least-32-characters-long';

describe('correction routes (corrections.md actions 4, 5, 6, 8, 9, 12)', () => {
  let app: FastifyInstance;
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let storageDir: string;
  let contributionId: string;
  let paymentId: string;
  let receiptId: string;
  let danaId: string;
  let robinId: string;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    for (const [id, pw] of [
      [baseline.adminUserId, 'admin-pass-phrase'],
      [baseline.cfoUserId, 'cfo-pass-phrase'],
      [baseline.designateUserId, 'designate-pass-phrase'],
    ] as const) {
      await prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(pw) } });
    }
    await prisma.user.create({
      data: {
        email: 'scoped@gpo.test',
        name: 'Scoped',
        role: 'rules_authority',
        passwordHash: await hashPassword('scoped-pass-phrase'),
        allRidings: false,
        ridingGrants: [5],
      },
    });

    const address = [{ housenumber: '1', street: 'Main St', city: 'Toronto', state: 'ON', postalcode: 'M1M1M1', country: 'CA' }];
    const dana = await prisma.contact.create({ data: { qomonContactId: 1n, name: 'Dana Donor', addresses: address } });
    const robin = await prisma.contact.create({ data: { qomonContactId: 2n, name: 'Robin Recipient', addresses: address } });
    danaId = dana.id;
    robinId = robin.id;

    const contribution = await createTestContribution(prisma, {
      qomonTransactionId: 1n,
      contactId: dana.id,
      amountCents: 10_000,
      acceptedAt: new Date('2026-03-01T12:00:00Z'),
    });
    contributionId = contribution.id;
    paymentId = contribution.paymentId;
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contribution.update({
        where: { id: contributionId },
        data: { periodId: baseline.periodId, entityKind: 'PARTY', receivedBy: 'GPO' },
      });
      await ctx.log({ subjectType: 'Contribution', subjectId: contributionId, after });
    });

    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-corrections-route-test-'));
    const issued = await issueReceipt(
      { prisma, storageDir },
      { contributionId, actorUserId: baseline.cfoUserId, reason: 'issue', politicalEntityLabel: 'Green Party of Ontario' },
    );
    receiptId = issued.id;

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

  async function post(url: string, who: [string, string], payload: unknown) {
    const cookie = await login(...who);
    return app.inject({ method: 'POST', url, cookies: { [cookie.name]: cookie.value }, payload: payload as object });
  }

  const CFO: [string, string] = ['cfo@gpo.test', 'cfo-pass-phrase'];
  const ADMIN: [string, string] = ['admin@gpo.test', 'admin-pass-phrase'];
  const DESIGNATE: [string, string] = ['designate@gpo.test', 'designate-pass-phrase'];

  const amountBody = () => ({
    action: 'CORRECT_AMOUNT',
    contributionId,
    amountCents: 8_000,
    paymentAmountCents: 8_000,
    reason: 'the cheque was for $80',
    politicalEntityLabel: 'Green Party of Ontario',
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'POST', url: '/corrections', payload: amountBody() });
    expect(res.statusCode).toBe(401);
    const preview = await app.inject({ method: 'POST', url: '/corrections/preview', payload: amountBody() });
    expect(preview.statusCode).toBe(401);
  });

  it('previews the cascade and writes nothing', async () => {
    const res = await post('/corrections/preview', ADMIN, amountBody());
    expect(res.statusCode).toBe(200);
    const plan = res.json();
    expect(plan.action).toBe('CORRECT_AMOUNT');
    expect(plan.cancelReceipts.map((c: { receiptId: string }) => c.receiptId)).toEqual([receiptId]);
    expect(plan.issueReceipts).toHaveLength(1);
    expect(plan.blockers).toEqual([]);

    expect((await prisma.contribution.findUniqueOrThrow({ where: { id: contributionId } })).status).toBe('ACTIVE');
    expect((await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } })).status).toBe('ISSUED');
  });

  it('403s a user who cannot correct contributions (a DC-1 designate has no contribution correction grant)', async () => {
    const res = await post('/corrections', DESIGNATE, amountBody());
    expect(res.statusCode).toBe(403);
  });

  it('lets an administrator correct an amount, reissuing the receipt', async () => {
    const res = await post('/corrections', ADMIN, amountBody());
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.supersededContributionIds).toEqual([contributionId]);
    expect(body.issuedReceipts).toHaveLength(1);
    expect(body.issuedReceipts[0].amountCents).toBe(8_000);
    expect((await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } })).status).toBe('CANCELLED');
  });

  it('moves a receipt to another donor', async () => {
    const res = await post('/corrections', CFO, {
      action: 'MOVE_RECEIPT',
      receiptId,
      toContactId: robinId,
      reason: 'the cheque was Robin\'s',
      politicalEntityLabel: 'Green Party of Ontario',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().issuedReceipts[0].contactId).toBe(robinId);
  });

  it('splits a contribution between two donors', async () => {
    const res = await post('/corrections', CFO, {
      action: 'SPLIT_CONTRIBUTION',
      contributionId,
      parts: [{ amountCents: 6_000 }, { amountCents: 4_000, contactId: robinId }],
      reason: 'joint cheque',
      politicalEntityLabel: 'Green Party of Ontario',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().createdContributionIds).toHaveLength(2);
  });

  it('refunds a payment', async () => {
    const res = await post('/corrections', ADMIN, { action: 'REFUND', paymentId, reason: 'returned to donor' });
    expect(res.statusCode).toBe(201);
    expect(res.json().refundedContributionIds).toEqual([contributionId]);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).state).toBe('REFUNDED');
  });

  it('needs a filer for a reallocation: 403 for an administrator, fine for the party CFO', async () => {
    await prisma.riding.create({ data: { ridingNumber: 12, name: 'Brampton West', active: true, qomonApiKey: 'x' } });
    const body = {
      action: 'REALLOCATE',
      contributionId,
      parts: [{ amountCents: 10_000, entityKind: 'CA', ridingNumber: 12 }],
      reason: 'over the party limit',
      entityLabels: { 'CA:12': 'Brampton West CA' },
    };
    expect((await post('/corrections', ADMIN, body)).statusCode).toBe(403);
    const ok = await post('/corrections', CFO, body);
    expect(ok.statusCode).toBe(201);
    expect(ok.json().issuedReceipts).toHaveLength(1);
  });

  it('403s a riding-scoped user on a contribution outside their grants', async () => {
    await prisma.riding.create({ data: { ridingNumber: 12, name: 'Brampton West', active: true, qomonApiKey: 'x' } });
    const scoped: [string, string] = ['scoped@gpo.test', 'scoped-pass-phrase'];
    // an unreceipted contribution in riding 12: the scoped role (grant: riding 5)
    // has `correct Contribution` but no business with another riding's rows
    const unreceipted = await createTestContribution(prisma, {
      qomonTransactionId: 9n,
      contactId: danaId,
      amountCents: 1_000,
      acceptedAt: new Date('2026-03-02T12:00:00Z'),
    });
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed' }, async (ctx) => {
      const after = await ctx.tx.contribution.update({
        where: { id: unreceipted.id },
        data: { periodId: baseline.periodId, entityKind: 'CA', ridingNumber: 12 },
      });
      await ctx.log({ subjectType: 'Contribution', subjectId: unreceipted.id, after });
    });
    const outside = await post('/corrections', scoped, { action: 'REFUND', contributionIds: [unreceipted.id], reason: 'returned' });
    expect(outside.statusCode).toBe(403);
    expect(outside.json().error).toContain('riding outside your grants');
  });

  it('409s a blocked cascade and 400s a bad request', async () => {
    const preview = await post('/corrections/preview', CFO, { ...amountBody(), amountCents: 20_000, paymentAmountCents: undefined });
    expect(preview.statusCode).toBe(409); // more than the payment
    const bad = await post('/corrections', CFO, { action: 'CORRECT_AMOUNT', contributionId, amountCents: 0, reason: 'x' });
    expect(bad.statusCode).toBe(400);
  });

  it('404s an unknown contribution', async () => {
    const res = await post('/corrections', CFO, { action: 'REFUND', contributionIds: ['nope'], reason: 'nothing here' });
    expect(res.statusCode).toBe(404);
  });

  describe('split, reprint, merge, unmerge, proposal', () => {
    async function consolidatedReceipt() {
      const second = await createTestContribution(prisma, {
        qomonTransactionId: 20n,
        contactId: danaId,
        amountCents: 2_000,
        acceptedAt: new Date('2026-03-02T12:00:00Z'),
      });
      await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed' }, async (ctx) => {
        const after = await ctx.tx.contribution.update({
          where: { id: second.id },
          data: { periodId: baseline.periodId, entityKind: 'PARTY', receivedBy: 'GPO' },
        });
        await ctx.log({ subjectType: 'Contribution', subjectId: second.id, after });
      });
      const { allocateToReceipt } = await import('../receipts/allocate.js');
      await allocateToReceipt({ prisma }, { receiptId, contributionId: second.id, actorUserId: baseline.cfoUserId, reason: 'consolidate' });
      return second.id;
    }

    it('previews and commits a receipt split', async () => {
      const secondId = await consolidatedReceipt();
      const body = {
        reason: 'two receipts please',
        politicalEntityLabel: 'Green Party of Ontario',
        groups: [{ contributionIds: [contributionId] }, { contributionIds: [secondId] }],
      };
      const preview = await post(`/receipts/${receiptId}/split-preview`, ADMIN, body);
      expect(preview.statusCode).toBe(200);
      expect(preview.json().issueReceipts).toHaveLength(2);
      expect((await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } })).status).toBe('ISSUED');

      const done = await post(`/receipts/${receiptId}/split`, ADMIN, body);
      expect(done.statusCode).toBe(201);
      expect(done.json().issuedReceipts).toHaveLength(2);
      expect((await post(`/receipts/${receiptId}/split`, DESIGNATE, body)).statusCode).toBe(409); // already cancelled
    });

    it('reprints a lost receipt and serves the copy', async () => {
      const res = await post(`/receipts/${receiptId}/reprint`, ADMIN, {
        kind: 'LOST_COPY',
        reason: 'donor lost it',
        politicalEntityLabel: 'Green Party of Ontario',
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ kind: 'LOST_COPY', lost: true });

      const cookie = await login(...ADMIN);
      const list = await app.inject({ method: 'GET', url: `/receipts/${receiptId}/reprints`, cookies: { [cookie.name]: cookie.value } });
      expect(list.json().data).toHaveLength(1);
      const pdf = await app.inject({
        method: 'GET',
        url: `/receipts/${receiptId}/reprints/${res.json().reprintId}/pdf`,
        cookies: { [cookie.name]: cookie.value },
      });
      expect(pdf.statusCode).toBe(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
    });

    it('422s a reprint that is not a spelling fix, 409s a material one', async () => {
      const res = await post(`/receipts/${receiptId}/reprint`, ADMIN, {
        kind: 'CORRECTED',
        correctedName: 'Robin Recipient',
        reason: 'wrong person',
        politicalEntityLabel: 'Green Party of Ontario',
      });
      expect(res.statusCode).toBe(409);
      const missing = await post(`/receipts/${receiptId}/reprint`, ADMIN, {
        kind: 'CORRECTED',
        reason: 'no name',
        politicalEntityLabel: 'Green Party of Ontario',
      });
      expect(missing.statusCode).toBe(422);
    });

    it('merges two contacts through the shared preview and commit, then unmerges', async () => {
      const preview = await post('/corrections/preview', CFO, {
        action: 'MERGE_CONTACTS',
        survivorId: robinId,
        mergedAwayId: danaId,
        reason: 'same person',
        politicalEntityLabel: 'Green Party of Ontario',
      });
      expect(preview.statusCode).toBe(200);
      expect(preview.json().changes).toHaveLength(1);

      const done = await post('/corrections', CFO, {
        action: 'MERGE_CONTACTS',
        survivorId: robinId,
        mergedAwayId: danaId,
        reason: 'same person',
        politicalEntityLabel: 'Green Party of Ontario',
      });
      expect(done.statusCode).toBe(201);
      expect((await prisma.contact.findUniqueOrThrow({ where: { id: danaId } })).mergedIntoId).toBe(robinId);

      const undone = await post(`/contacts/${danaId}/unmerge`, CFO, { reason: 'they are two people' });
      expect(undone.statusCode).toBe(200);
      expect((await prisma.contact.findUniqueOrThrow({ where: { id: danaId } })).mergedIntoId).toBeNull();
      expect((await post(`/contacts/${danaId}/unmerge`, CFO, { reason: 'again' })).statusCode).toBe(409);
    });

    it('serves a reallocation proposal to anyone who can read contributions', async () => {
      const cookie = await login(...ADMIN);
      const res = await app.inject({
        method: 'GET',
        url: `/contributions/${contributionId}/reallocation-proposal`,
        cookies: { [cookie.name]: cookie.value },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ contributionId, overLimitBucket: null, options: [] });
    });

    it('searches contacts for the donor picker, leaving out merged-away ones', async () => {
      const cookie = await login(...ADMIN);
      const search = (query: string) =>
        app.inject({ method: 'GET', url: `/contacts?query=${query}`, cookies: { [cookie.name]: cookie.value } });

      const found = await search('robin');
      expect(found.statusCode).toBe(200);
      expect(found.json().data.map((c: { name: string }) => c.name)).toEqual(['Robin Recipient']);
      expect(found.json().data[0].qomonContactId).toBe('2');

      await post('/corrections', CFO, {
        action: 'MERGE_CONTACTS',
        survivorId: danaId,
        mergedAwayId: robinId,
        reason: 'same person',
      });
      expect((await search('robin')).json().data).toEqual([]);
      expect((await search('r')).statusCode).toBe(400); // too short to be a useful search
    });
  });
});
