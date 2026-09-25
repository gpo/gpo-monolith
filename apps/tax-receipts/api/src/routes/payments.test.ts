import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { resetDb, seedBaseline, testPrisma } from '../test/db.js';

const prisma = testPrisma();
const SECRET = 'test-session-secret-at-least-32-characters-long';

describe('payment entry routes (D12 manual entry)', () => {
  let app: FastifyInstance;
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let danaId: string;
  let samId: string;

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
        name: 'Scoped admin',
        role: 'administrator',
        passwordHash: await hashPassword('scoped-pass-phrase'),
        allRidings: false,
        ridingGrants: [5],
      },
    });
    await prisma.riding.create({ data: { ridingNumber: 12, name: 'Brampton West', active: true, qomonApiKey: 'x' } });
    danaId = (await prisma.contact.create({ data: { name: 'Dana Donor' } })).id;
    samId = (await prisma.contact.create({ data: { name: 'Sam Spouse' } })).id;

    app = await buildApp({ prisma, sessionSecret: SECRET, artifactStorageDir: '/tmp/unused' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const ADMIN: [string, string] = ['admin@gpo.test', 'admin-pass-phrase'];
  const DESIGNATE: [string, string] = ['designate@gpo.test', 'designate-pass-phrase'];
  const SCOPED: [string, string] = ['scoped@gpo.test', 'scoped-pass-phrase'];

  async function call(method: 'GET' | 'POST', url: string, who: [string, string] | null, payload?: unknown) {
    const cookies: Record<string, string> = {};
    if (who) {
      const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: who[0], password: who[1] } });
      const cookie = login.cookies[0]!;
      cookies[cookie.name] = cookie.value;
    }
    return app.inject({ method, url, cookies, ...(payload ? { payload: payload as object } : {}) });
  }

  const payment = () => ({
    reason: 'cheque at the office',
    contactId: danaId,
    amountCents: 7_500,
    receivedAt: '2026-04-10T15:00:00.000Z',
    method: 'CHEQUE',
    externalRef: 'cheque-1042',
  });

  it('requires authentication and the create ability', async () => {
    expect((await call('POST', '/payments', null, payment())).statusCode).toBe(401);
    expect((await call('POST', '/payments', DESIGNATE, payment())).statusCode).toBe(403);
    expect((await call('GET', '/intake-preview?acceptedAt=2026-04-10', DESIGNATE)).statusCode).toBe(403);
  });

  it('records a payment with a single contribution covering it, and reports the derived period', async () => {
    const res = await call('POST', '/payments', ADMIN, payment());
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.contributions).toHaveLength(1);
    expect(body.contributions[0]).toMatchObject({ amountCents: 7_500, periodId: baseline.periodId });
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: body.paymentId } });
    expect(row).toMatchObject({ source: 'MANUAL', method: 'CHEQUE', externalRef: 'cheque-1042', createdByUserId: baseline.adminUserId });
  });

  it('records a split payment with per-contribution overrides', async () => {
    const res = await call('POST', '/payments', ADMIN, {
      ...payment(),
      contributions: [
        { amountCents: 4_000 },
        { amountCents: 2_000, contactId: samId, note: 'Sam\'s share' },
        { amountCents: 1_000, descriptive: { entity_kind: 'CA', riding_number: 12, received_by: 'GPO' } },
      ],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().contributions).toHaveLength(3);
    const ca = await prisma.contribution.findFirstOrThrow({ where: { entityKind: 'CA' } });
    expect(ca.ridingNumber).toBe(12);
  });

  it('422s an entry the service refuses, and 400s a malformed body', async () => {
    const tooMuch = await call('POST', '/payments', ADMIN, { ...payment(), contributions: [{ amountCents: 8_000 }] });
    expect(tooMuch.statusCode).toBe(422);
    expect(tooMuch.json().error).toContain('add up to');
    const noPeriod = await call('POST', '/payments', ADMIN, { ...payment(), receivedAt: '2010-01-01T00:00:00.000Z' });
    expect(noPeriod.statusCode).toBe(422);
    expect((await call('POST', '/payments', ADMIN, { ...payment(), amountCents: 0 })).statusCode).toBe(400);
    expect((await call('POST', '/payments', ADMIN, { ...payment(), reason: 'x' })).statusCode).toBe(400);
  });

  it('403s a riding-scoped user entering a contribution for another riding', async () => {
    const res = await call('POST', '/payments', SCOPED, {
      ...payment(),
      contributions: [{ amountCents: 7_500, descriptive: { entity_kind: 'CA', riding_number: 12 } }],
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('outside your grants');
    // a party-level entry is fine for them
    expect((await call('POST', '/payments', SCOPED, payment())).statusCode).toBe(201);
  });

  it('attributes what is left of a payment, and shows the payment with its unattributed amount', async () => {
    const created = await call('POST', '/payments', ADMIN, { ...payment(), contributions: [{ amountCents: 5_000 }] });
    const paymentId = created.json().paymentId as string;

    const before = await call('GET', `/payments/${paymentId}`, ADMIN);
    expect(before.json()).toMatchObject({ contactName: 'Dana Donor', amountCents: 7_500, attributedCents: 5_000, unattributedCents: 2_500 });

    const added = await call('POST', `/payments/${paymentId}/contributions`, ADMIN, {
      reason: 'the rest was Sam\'s',
      contactId: samId,
      amountCents: 2_500,
    });
    expect(added.statusCode).toBe(201);
    expect(added.json().remainingCents).toBe(0);

    const after = await call('GET', `/payments/${paymentId}`, ADMIN);
    expect(after.json().unattributedCents).toBe(0);
    expect(after.json().contributions).toHaveLength(2);
    expect((await call('POST', `/payments/${paymentId}/contributions`, ADMIN, { reason: 'again', amountCents: 1 })).statusCode).toBe(422);
    expect((await call('GET', '/payments/nope', ADMIN)).statusCode).toBe(404);
  });

  it('serves the intake preview, and puts unattributed on the contribution detail', async () => {
    const preview = await call('GET', '/intake-preview?acceptedAt=2026-04-10T15:00:00Z&ridingNumber=12', ADMIN);
    expect(preview.statusCode).toBe(200);
    expect(preview.json().descriptive).toMatchObject({ period_id: baseline.periodId, riding_number: 12 });
    expect(preview.json().flags.length).toBeGreaterThan(0);

    const created = await call('POST', '/payments', ADMIN, { ...payment(), contributions: [{ amountCents: 5_000 }] });
    const detail = await call('GET', `/contributions/${created.json().contributions[0].id}`, ADMIN);
    expect(detail.json().payment.unattributedCents).toBe(2_500);
  });
});
