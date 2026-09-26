import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { withChangeLog } from '../changelog/write.js';
import type { EmailProvider } from '../delivery/email-provider.js';
import { ResendEmailProvider } from '../delivery/resend-provider.js';
import { createTestContribution, resetDb, seedBaseline, testPrisma } from '../test/db.js';

const prisma = testPrisma();
const SECRET = 'test-session-secret-at-least-32-characters-long';
const WEBHOOK_KEY = Buffer.from('route-test-webhook-secret-bytes!');

describe('delivery routes (tickets 3.6, 3.12)', () => {
  let app: FastifyInstance;
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let storageDir: string;
  const space = () => `/spaces/${baseline.periodId}/PARTY`;

  async function start(emailProvider?: EmailProvider, emailLiveSendingAllowed?: boolean) {
    app = await buildApp({
      prisma,
      sessionSecret: SECRET,
      artifactStorageDir: storageDir,
      emailProvider,
      emailLiveSendingAllowed,
    });
    await app.ready();
  }

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    await prisma.user.update({ where: { id: baseline.cfoUserId }, data: { passwordHash: await hashPassword('cfo-pass-phrase') } });
    await prisma.user.update({
      where: { id: baseline.adminUserId },
      data: { passwordHash: await hashPassword('admin-pass-phrase') },
    });
    await prisma.user.create({
      data: {
        email: 'sys@gpo.test',
        name: 'Sys',
        role: 'sysadmin',
        passwordHash: await hashPassword('sys-pass-phrase'),
        allRidings: true,
      },
    });

    const contact = await prisma.contact.create({
      data: {
        qomonContactId: 1n,
        name: 'Emma Emailer',
        email: 'emma@example.org',
        addresses: [{ housenumber: '1', street: 'Main St', city: 'Toronto', state: 'ON', postalcode: 'M1M1M1', country: 'CA' }],
      },
    });
    const contribution = await createTestContribution(prisma, {
      qomonTransactionId: 1n,
      contactId: contact.id,
      amountCents: 5_000,
      acceptedAt: new Date('2026-03-01T12:00:00Z'),
    });
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed' }, async (ctx) => {
      const after = await ctx.tx.contribution.update({
        where: { id: contribution.id },
        data: { periodId: baseline.periodId, entityKind: 'PARTY', receivedBy: 'GPO' },
      });
      await ctx.log({ subjectType: 'Contribution', subjectId: contribution.id, after });
    });
    await prisma.donorCyclePreference.create({ data: { contactId: contact.id, year: 2026, delivery: 'EMAIL' } });
    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-delivery-routes-test-'));
  });

  afterEach(async () => {
    await app.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  async function login(email: string, password: string) {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    const cookie = res.cookies[0]!;
    return { [cookie.name]: cookie.value };
  }

  async function issueAsCfo() {
    const cookies = await login('cfo@gpo.test', 'cfo-pass-phrase');
    const res = await app.inject({
      method: 'POST',
      url: `${space()}/receipts`,
      cookies,
      payload: { reason: 'issue', politicalEntityLabel: 'Green Party of Ontario' },
    });
    expect(res.statusCode).toBe(201);
    return cookies;
  }

  const emailPayload = { reason: 'send', subject: 'Your receipt', coverLetterBody: 'Thank you.' };

  it('lets only an issuer queue email, and reports the space delivery picture', async () => {
    await start();
    const cfo = await issueAsCfo();

    const admin = await login('admin@gpo.test', 'admin-pass-phrase');
    const denied = await app.inject({ method: 'POST', url: `${space()}/deliver/email`, cookies: admin, payload: emailPayload });
    expect(denied.statusCode).toBe(403);

    const queued = await app.inject({ method: 'POST', url: `${space()}/deliver/email`, cookies: cfo, payload: emailPayload });
    expect(queued.statusCode).toBe(201);
    expect(queued.json().queued).toHaveLength(1);

    const summary = await app.inject({ method: 'GET', url: `${space()}/delivery`, cookies: admin });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({
      issuedCount: 1,
      deliveredCount: 0,
      email: { readyToQueue: 0, queued: 1, sent: 0, delivered: 0 },
      stage: 'issued',
    });
  });

  it('simulates on demand and plays a simulated bounce through to a print batch (dev provider)', async () => {
    await start();
    const cfo = await issueAsCfo();
    await app.inject({ method: 'POST', url: `${space()}/deliver/email`, cookies: cfo, payload: emailPayload });

    const sys = await login('sys@gpo.test', 'sys-pass-phrase');
    expect((await app.inject({ method: 'POST', url: '/admin/emails/dispatch', cookies: cfo })).statusCode).toBe(403);
    const dispatched = await app.inject({ method: 'POST', url: '/admin/emails/dispatch', cookies: sys });
    expect(dispatched.json()).toMatchObject({ mode: 'simulated', sent: 1 });

    const outbox = await app.inject({ method: 'GET', url: '/admin/emails', cookies: sys });
    expect(outbox.json()).toMatchObject({
      data: [{ status: 'SENT', simulated: true, toAddress: 'emma@example.org', receiptNumber: expect.any(String) }],
      nextCursor: null,
    });
    const emailId = outbox.json().data[0].id;

    const bounced = await app.inject({
      method: 'POST',
      url: `/admin/emails/${emailId}/simulate`,
      cookies: sys,
      payload: { type: 'bounced' },
    });
    expect(bounced.json()).toMatchObject({ applied: 1 });

    const batch = await app.inject({
      method: 'POST',
      url: `${space()}/print-batches`,
      cookies: cfo,
      payload: { reason: 'print run', coverLetterBody: 'Thank you.' },
    });
    expect(batch.statusCode).toBe(201);
    const batchId = batch.json().printBatch.id;

    const pdf = await app.inject({ method: 'GET', url: `/print-batches/${batchId}/pdf`, cookies: cfo });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');

    const again = await app.inject({
      method: 'POST',
      url: `${space()}/print-batches`,
      cookies: cfo,
      payload: { reason: 'print run', coverLetterBody: 'Thank you.' },
    });
    expect(again.statusCode).toBe(409);

    const future = await app.inject({
      method: 'POST',
      url: `/print-batches/${batchId}/mailed`,
      cookies: cfo,
      payload: { reason: 'posted', mailedOn: '2099-01-01' },
    });
    expect(future.statusCode).toBe(400);

    const mailed = await app.inject({
      method: 'POST',
      url: `/print-batches/${batchId}/mailed`,
      cookies: cfo,
      payload: { reason: 'posted' },
    });
    expect(mailed.statusCode).toBe(200);
    expect(mailed.json()).toMatchObject({ deliveredCount: 1, closedWorkItemIds: [expect.any(String)] });

    const summary = await app.inject({ method: 'GET', url: `${space()}/delivery`, cookies: cfo });
    expect(summary.json()).toMatchObject({ deliveredCount: 1, problems: [], stage: 'delivered' });
  });

  describe('with a real provider adapter', () => {
    function signed(body: string, key = WEBHOOK_KEY) {
      const id = `evt_${Math.random().toString(36).slice(2)}`;
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
      return { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}`, 'content-type': 'application/json' };
    }

    let fetchCalls: number;

    async function startResend(liveSendingAllowed: boolean) {
      fetchCalls = 0;
      const fetchImpl = (async () => {
        fetchCalls += 1;
        return new Response(JSON.stringify({ id: 'resend-email-1' }), { status: 200 });
      }) as unknown as typeof fetch;
      await start(
        new ResendEmailProvider({
          apiKey: 're_test',
          from: 'GPO <receipts@mail.example.org>',
          webhookSecret: `whsec_${WEBHOOK_KEY.toString('base64')}`,
          fetch: fetchImpl,
        }),
        liveSendingAllowed,
      );
    }

    async function goLive(cookies: Record<string, string>) {
      const res = await app.inject({
        method: 'PUT',
        url: '/admin/email-settings',
        cookies,
        payload: { liveSendingEnabled: true, reason: 'production go-live' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ provider: 'resend', mode: 'live' });
    }

    it('never calls the provider where the environment does not allow live sending', async () => {
      await startResend(false);
      const cfo = await issueAsCfo();
      await app.inject({ method: 'POST', url: `${space()}/deliver/email`, cookies: cfo, payload: emailPayload });
      const sys = await login('sys@gpo.test', 'sys-pass-phrase');

      const settings = await app.inject({ method: 'GET', url: '/admin/email-settings', cookies: sys });
      expect(settings.json()).toMatchObject({
        provider: 'resend',
        liveSendingAllowed: false,
        liveSendingEnabled: false,
        mode: 'simulated',
      });
      const refused = await app.inject({
        method: 'PUT',
        url: '/admin/email-settings',
        cookies: sys,
        payload: { liveSendingEnabled: true, reason: 'try it' },
      });
      expect(refused.statusCode).toBe(409);

      const dispatched = await app.inject({ method: 'POST', url: '/admin/emails/dispatch', cookies: sys });
      expect(dispatched.json()).toMatchObject({ mode: 'simulated', sent: 1 });
      expect(fetchCalls).toBe(0);
    });

    it('lets only a sysadmin see or change the email settings', async () => {
      await startResend(true);
      const cfo = await login('cfo@gpo.test', 'cfo-pass-phrase');
      expect((await app.inject({ method: 'GET', url: '/admin/email-settings', cookies: cfo })).statusCode).toBe(403);
      const put = await app.inject({
        method: 'PUT',
        url: '/admin/email-settings',
        cookies: cfo,
        payload: { liveSendingEnabled: true, reason: 'go live' },
      });
      expect(put.statusCode).toBe(403);
      expect((await app.inject({ method: 'GET', url: '/admin/emails', cookies: cfo })).statusCode).toBe(403);
    });

    it('applies a signed bounce webhook and refuses an unsigned one', async () => {
      await startResend(true);
      const cfo = await issueAsCfo();
      await app.inject({ method: 'POST', url: `${space()}/deliver/email`, cookies: cfo, payload: emailPayload });
      const sys = await login('sys@gpo.test', 'sys-pass-phrase');
      await goLive(sys);
      await app.inject({ method: 'POST', url: '/admin/emails/dispatch', cookies: sys });
      expect(fetchCalls).toBe(1);

      const body = JSON.stringify({
        type: 'email.bounced',
        created_at: new Date().toISOString(),
        data: { email_id: 'resend-email-1', bounce: { type: 'Permanent', subType: 'General', message: 'no such user' } },
      });

      const unsigned = await app.inject({
        method: 'POST',
        url: '/webhooks/email',
        headers: { 'content-type': 'application/json' },
        payload: body,
      });
      expect(unsigned.statusCode).toBe(401);
      const forged = await app.inject({
        method: 'POST',
        url: '/webhooks/email',
        headers: signed(body, Buffer.from('not-the-secret')),
        payload: body,
      });
      expect(forged.statusCode).toBe(401);

      const ok = await app.inject({ method: 'POST', url: '/webhooks/email', headers: signed(body), payload: body });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toEqual({ applied: 1, duplicates: 0, unknown: 0 });

      const summary = await app.inject({ method: 'GET', url: `${space()}/delivery`, cookies: cfo });
      expect(summary.json()).toMatchObject({
        mail: { readyToPrint: 1 },
        problems: [{ detail: 'Permanent: General: no such user' }],
      });
    });

    it('shows one email with its events, and refuses a simulated event on a really-sent email', async () => {
      await startResend(true);
      const cfo = await issueAsCfo();
      await app.inject({ method: 'POST', url: `${space()}/deliver/email`, cookies: cfo, payload: emailPayload });
      const sys = await login('sys@gpo.test', 'sys-pass-phrase');
      await goLive(sys);
      await app.inject({ method: 'POST', url: '/admin/emails/dispatch', cookies: sys });

      const body = JSON.stringify({
        type: 'email.delivered',
        created_at: new Date().toISOString(),
        data: { email_id: 'resend-email-1' },
      });
      await app.inject({ method: 'POST', url: '/webhooks/email', headers: signed(body), payload: body });

      const list = await app.inject({ method: 'GET', url: '/admin/emails?q=EMMA&status=DELIVERED', cookies: sys });
      expect(list.json().data).toHaveLength(1);
      const none = await app.inject({ method: 'GET', url: '/admin/emails?simulated=true', cookies: sys });
      expect(none.json().data).toHaveLength(0);

      const id = list.json().data[0].id;
      const detail = await app.inject({ method: 'GET', url: `/admin/emails/${id}`, cookies: sys });
      expect(detail.json()).toMatchObject({
        status: 'DELIVERED',
        simulated: false,
        provider: 'resend',
        textBody: expect.stringContaining('Emma Emailer'),
        events: [{ type: 'delivered' }],
      });

      const simulate = await app.inject({
        method: 'POST',
        url: `/admin/emails/${id}/simulate`,
        cookies: sys,
        payload: { type: 'bounced' },
      });
      expect(simulate.statusCode).toBe(409);
    });
  });
});
