import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { withChangeLog } from '../changelog/write.js';
import { makeContribution, resetDb, seedBaseline, testPrisma } from '../test/db.js';

const prisma = testPrisma();
const SECRET = 'test-session-secret-at-least-32-characters-long';

describe('RTD filings routes (ticket 2.8, reworked for the prepare/send redesign)', () => {
  let app: FastifyInstance;
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let storageDir: string;
  let nextContactId: bigint;
  let nextTxId: bigint;

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
    // The filer role prepares filings (`create` on RtdFiling); the party CFO
    // can `file` (mark sent) but not `create` one from scratch -- abilities.ts's
    // deliberate split, ticket 0.5. In practice, a real RTD designate is
    // assigned the `filer` role directly (see test/db.ts's `designate`
    // fixture) and so can do both steps solo end to end.
    await prisma.user.update({
      where: { id: baseline.designateUserId },
      data: { passwordHash: await hashPassword('filer-pass-phrase') },
    });
    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-rtd-routes-test-'));
    app = await buildApp({ prisma, sessionSecret: SECRET, artifactStorageDir: storageDir });
    await app.ready();
    nextContactId = 1n;
    nextTxId = 1n;
  });

  afterEach(async () => {
    await app.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  async function login(email: string, password: string) {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    return res.cookies[0]!;
  }

  async function seedDraftCandidate(amountCents = 25_000, acceptedAt = new Date('2026-03-01T12:00:00Z')) {
    const made = await makeContribution(prisma, {
      qomonContactId: nextContactId++,
      qomonTransactionId: nextTxId++,
      amountCents,
      acceptedAt,
      contactFirstName: 'Dana',
      contactLastName: 'Donor',
    });
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contributionMetadata.create({
        data: {
          contributionId: made.contributionId,
          periodId: baseline.periodId,
          entityKind: 'PARTY',
          ridingNumber: null,
          receivedBy: 'GPO',
          goodsServices: false,
        },
      });
      await ctx.log({ subjectType: 'ContributionMetadata', subjectId: made.contributionId, after });
    });
    return made;
  }

  it('requires authentication on every route', async () => {
    const draft = await app.inject({ method: 'GET', url: '/rtd/draft?year=2026' });
    expect(draft.statusCode).toBe(401);
    const list = await app.inject({ method: 'GET', url: '/rtd/filings' });
    expect(list.statusCode).toBe(401);
  });

  it('the draft builder lists an unreported over-threshold row with gate findings and the clock', async () => {
    const candidate = await seedDraftCandidate();
    const cookie = await login('cfo@gpo.test', 'cfo-pass-phrase');

    const res = await app.inject({
      method: 'GET',
      url: '/rtd/draft?year=2026',
      cookies: { [cookie.name]: cookie.value },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].contributionId).toBe(candidate.contributionId);
    expect(body.rows[0].gateFindings).toEqual([]);
    expect(typeof body.rows[0].dueDate).toBe('string');
  });

  it('403s an administrator preparing a filing (only party CFO / filer / designate may create one)', async () => {
    const candidate = await seedDraftCandidate();
    const cookie = await login('admin@gpo.test', 'admin-pass-phrase');
    const res = await app.inject({
      method: 'POST',
      url: '/rtd/filings',
      cookies: { [cookie.name]: cookie.value },
      payload: { year: 2026, contributionIds: [candidate.contributionId], reason: 'prepare it', cfoName: 'Casey CFO' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets the filer prepare a filing, download it unsent, and the party CFO mark it sent', async () => {
    const candidate = await seedDraftCandidate(20_001, new Date('2026-03-05T12:00:00Z'));
    const filerCookie = await login('designate@gpo.test', 'filer-pass-phrase');

    const prepareRes = await app.inject({
      method: 'POST',
      url: '/rtd/filings',
      cookies: { [filerCookie.name]: filerCookie.value },
      payload: { year: 2026, contributionIds: [candidate.contributionId], reason: 'first filing', cfoName: 'Casey CFO' },
    });
    expect(prepareRes.statusCode).toBe(201);
    const filingId = prepareRes.json().rtdFilingId;

    const cfoCookie = await login('cfo@gpo.test', 'cfo-pass-phrase');
    const listRes = await app.inject({
      method: 'GET',
      url: '/rtd/filings',
      cookies: { [cfoCookie.name]: cfoCookie.value },
    });
    expect(listRes.json().data).toHaveLength(1);
    expect(listRes.json().data[0].rowCount).toBe(1);
    expect(listRes.json().data[0].artifactId).not.toBeNull();
    expect(listRes.json().data[0].submittedAt).toBeNull();

    // Already archived at prepare time -- no separate archive step, and no
    // need to have prepared it yourself to download it.
    const downloadRes = await app.inject({
      method: 'GET',
      url: `/rtd/filings/${filingId}/download`,
      cookies: { [cfoCookie.name]: cfoCookie.value },
    });
    expect(downloadRes.statusCode).toBe(200);
    expect(downloadRes.headers['content-type']).toBe('text/csv');
    expect(downloadRes.body).toContain('Entity ID,CFO Name');
    expect(downloadRes.body).toContain('Casey CFO');

    const sendRes = await app.inject({
      method: 'POST',
      url: `/rtd/filings/${filingId}/send`,
      cookies: { [cfoCookie.name]: cfoCookie.value },
      payload: { reason: 'emailed to EO 2026-03-06' },
    });
    expect(sendRes.statusCode).toBe(201);
    expect(sendRes.json().submittedAt).not.toBeNull();

    const listAfterSend = await app.inject({
      method: 'GET',
      url: '/rtd/filings',
      cookies: { [cfoCookie.name]: cfoCookie.value },
    });
    expect(listAfterSend.json().data[0].submittedAt).not.toBeNull();
    expect(listAfterSend.json().data[0].submittedBy).toBe(baseline.cfoUserId);
  });

  it('403s an administrator marking a filing sent (only party CFO / filer / designate may file one)', async () => {
    const candidate = await seedDraftCandidate();
    const filerCookie = await login('designate@gpo.test', 'filer-pass-phrase');
    const prepareRes = await app.inject({
      method: 'POST',
      url: '/rtd/filings',
      cookies: { [filerCookie.name]: filerCookie.value },
      payload: { year: 2026, contributionIds: [candidate.contributionId], reason: 'first filing', cfoName: 'Casey CFO' },
    });
    const filingId = prepareRes.json().rtdFilingId;

    const adminCookie = await login('admin@gpo.test', 'admin-pass-phrase');
    const sendRes = await app.inject({
      method: 'POST',
      url: `/rtd/filings/${filingId}/send`,
      cookies: { [adminCookie.name]: adminCookie.value },
      payload: { reason: 'attempt' },
    });
    expect(sendRes.statusCode).toBe(403);
  });

  it('blocks a prepare attempt that includes a gate-flagged row, with the finding in the response', async () => {
    const flagged = await seedDraftCandidate();
    await prisma.workItem.create({
      data: { kind: 'VALIDATION', subjectType: 'Contribution', subjectId: flagged.contributionId, ruleRef: 'B1' },
    });
    const cookie = await login('designate@gpo.test', 'filer-pass-phrase');

    const res = await app.inject({
      method: 'POST',
      url: '/rtd/filings',
      cookies: { [cookie.name]: cookie.value },
      payload: { year: 2026, contributionIds: [flagged.contributionId], reason: 'attempt', cfoName: 'Casey CFO' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().blocked[0].gateFindings[0].ruleRef).toBe('B1');
  });

  it('generates a DC-1A amendment for a contribution in a SENT filing, and 422s while only prepared', async () => {
    const candidate = await seedDraftCandidate();
    const filerCookie = await login('designate@gpo.test', 'filer-pass-phrase');
    const prepareRes = await app.inject({
      method: 'POST',
      url: '/rtd/filings',
      cookies: { [filerCookie.name]: filerCookie.value },
      payload: { year: 2026, contributionIds: [candidate.contributionId], reason: 'first filing', cfoName: 'Casey CFO' },
    });
    expect(prepareRes.statusCode).toBe(201);
    const filingId = prepareRes.json().rtdFilingId;

    const cfoCookie = await login('cfo@gpo.test', 'cfo-pass-phrase');

    // Prepared but not yet sent: DC-1A doesn't apply yet -- nothing has
    // actually been reported to EO.
    const tooEarly = await app.inject({
      method: 'POST',
      url: `/rtd/contributions/${candidate.contributionId}/dc1a`,
      cookies: { [cfoCookie.name]: cfoCookie.value },
      payload: { reason: 'amount corrected' },
    });
    expect(tooEarly.statusCode).toBe(422);

    const sendRes = await app.inject({
      method: 'POST',
      url: `/rtd/filings/${filingId}/send`,
      cookies: { [cfoCookie.name]: cfoCookie.value },
      payload: { reason: 'emailed to EO' },
    });
    expect(sendRes.statusCode).toBe(201);

    // The party CFO can `file` an EOForm (generate the DC-1A) without
    // having prepared the original filing.
    const dc1aRes = await app.inject({
      method: 'POST',
      url: `/rtd/contributions/${candidate.contributionId}/dc1a`,
      cookies: { [cfoCookie.name]: cfoCookie.value },
      payload: { reason: 'amount corrected' },
    });
    expect(dc1aRes.statusCode).toBe(201);
    expect(dc1aRes.json().filingName).toContain('2026_RTD_8_');
    expect(dc1aRes.json().filingName).toMatch(/_DC1A$/);
  });

  it('422s a DC-1A attempt on a contribution that was never RTD-reported', async () => {
    const candidate = await seedDraftCandidate();
    const cookie = await login('cfo@gpo.test', 'cfo-pass-phrase');
    const res = await app.inject({
      method: 'POST',
      url: `/rtd/contributions/${candidate.contributionId}/dc1a`,
      cookies: { [cookie.name]: cookie.value },
      payload: { reason: 'never reported' },
    });
    expect(res.statusCode).toBe(422);
  });
});
