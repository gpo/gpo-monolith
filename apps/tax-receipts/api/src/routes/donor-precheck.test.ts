import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { withChangeLog } from '../changelog/write.js';
import { sendDonorPrechecksForSpace } from '../donors/precheck.js';
import { resetDb, seedBaseline, testPrisma, createTestContribution } from '../test/db.js';

const prisma = testPrisma();
const SECRET = 'test-session-secret-at-least-32-characters-long';

describe('donor pre-check confirmation route (ticket 3.9)', () => {
  let app: FastifyInstance;
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let token: string;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);

    const contact = await prisma.contact.create({
      data: { qomonContactId: 1n, name: 'Dana Donor', email: 'dana@example.org' },
    });
    const contribution = await createTestContribution(prisma, { qomonTransactionId: 1n, contactId: contact.id, amountCents: 5_000, acceptedAt: new Date('2026-03-01T12:00:00Z') });
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contribution.update({ where: { id: contribution.id }, data: { periodId: baseline.periodId, entityKind: 'PARTY', receivedBy: 'GPO' } });
      await ctx.log({ subjectType: 'Contribution', subjectId: contribution.id, after });
    });

    const sent = await sendDonorPrechecksForSpace(prisma, {
      periodId: baseline.periodId,
      ridingNumber: null,
      entityKind: 'PARTY',
      actorUserId: baseline.adminUserId,
      reason: 'annual pre-check window opens',
    });
    token = sent.sent[0]!.confirmationToken;

    app = await buildApp({ prisma, sessionSecret: SECRET });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('needs no session at all — the token is the credential', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/donor-precheck/${token}/confirm`,
      payload: { delivery: 'EMAIL', address: { line1: '42 Wallaby Way', city: 'Ottawa', province: 'ON', postalCode: 'K1A0A1' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().delivery).toBe('EMAIL');
  });

  it('404s an unknown token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/donor-precheck/not-a-real-token/confirm',
      payload: { delivery: 'MAIL', address: { line1: '1 Main St', city: 'Toronto', province: 'ON', postalCode: 'M1M1M1' } },
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s a token that has already been used', async () => {
    await app.inject({
      method: 'POST',
      url: `/donor-precheck/${token}/confirm`,
      payload: { delivery: 'EMAIL', address: { line1: '42 Wallaby Way', city: 'Ottawa', province: 'ON', postalCode: 'K1A0A1' } },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/donor-precheck/${token}/confirm`,
      payload: { delivery: 'MAIL', address: { line1: '42 Wallaby Way', city: 'Ottawa', province: 'ON', postalCode: 'K1A0A1' } },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400s a missing address field', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/donor-precheck/${token}/confirm`,
      payload: { delivery: 'EMAIL', address: { line1: '42 Wallaby Way', city: 'Ottawa', province: 'ON' } },
    });
    expect(res.statusCode).toBe(400);
  });
});
