import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { defineAbilitiesFor } from './abilities.js';
import { assertIssuanceEnabled, IssuanceDisabledError, setKillSwitch } from './kill-switch.js';
import { hashPassword } from './password.js';
import { resetDb, seedBaseline, testPrisma } from '../test/db.js';

const prisma = testPrisma();
const SECRET = 'test-session-secret-at-least-32-characters-long';

describe('auth + authorization (ticket 0.5)', () => {
  let app: FastifyInstance;
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    await prisma.user.update({
      where: { id: baseline.cfoUserId },
      data: { passwordHash: await hashPassword('correct-horse-battery') },
    });
    app = await buildApp({ prisma, sessionSecret: SECRET });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves a hello route and a health check', async () => {
    const root = await app.inject({ method: 'GET', url: '/' });
    expect(root.statusCode).toBe(200);
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.json()).toMatchObject({ status: 'ok', db: 'up' });
  });

  it('logs a user in and exposes their identity + permissions', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'cfo@gpo.test', password: 'correct-horse-battery' },
    });
    expect(login.statusCode).toBe(200);
    const cookie = login.cookies[0]!;

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      cookies: { [cookie.name]: cookie.value },
    });
    expect(me.json()).toMatchObject({
      email: 'cfo@gpo.test',
      role: 'party_cfo',
      can: { issueReceipts: true, administerKillSwitch: true },
    });
  });

  it('rejects a bad password', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'cfo@gpo.test', password: 'wrong' },
    });
    expect(login.statusCode).toBe(401);
  });

  it('CASL: only the party CFO (or a designate) may issue receipts', () => {
    expect(
      defineAbilitiesFor({
        id: 'u',
        role: 'party_cfo',
        isCfoDesignate: false,
        allRidings: true,
        ridingGrants: [],
      }).can('issue', 'Receipt'),
    ).toBe(true);

    expect(
      defineAbilitiesFor({
        id: 'u',
        role: 'administrator',
        isCfoDesignate: false,
        allRidings: true,
        ridingGrants: [],
      }).can('issue', 'Receipt'),
    ).toBe(false);

    expect(
      defineAbilitiesFor({
        id: 'u',
        role: 'filer',
        isCfoDesignate: true,
        allRidings: true,
        ridingGrants: [],
      }).can('issue', 'Receipt'),
    ).toBe(true);
  });

  it('kill switch: CFO can engage it, an administrator cannot', async () => {
    const cfoLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'cfo@gpo.test', password: 'correct-horse-battery' },
    });
    const cfoCookie = cfoLogin.cookies[0]!;

    const engage = await app.inject({
      method: 'POST',
      url: '/admin/kill-switch',
      cookies: { [cfoCookie.name]: cfoCookie.value },
      payload: { engaged: true, reason: 'CEO request 2026-09-10' },
    });
    expect(engage.statusCode).toBe(200);
    expect(engage.json()).toMatchObject({ engaged: true });

    await prisma.user.update({
      where: { id: baseline.adminUserId },
      data: { passwordHash: await hashPassword('admin-pass-phrase') },
    });
    const adminLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@gpo.test', password: 'admin-pass-phrase' },
    });
    const adminCookie = adminLogin.cookies[0]!;
    const forbidden = await app.inject({
      method: 'POST',
      url: '/admin/kill-switch',
      cookies: { [adminCookie.name]: adminCookie.value },
      payload: { engaged: false, reason: 'trying to re-enable' },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it('assertIssuanceEnabled throws once the kill switch is engaged, and a change-log entry is written', async () => {
    await assertIssuanceEnabled(prisma); // fine while disengaged
    await setKillSwitch(
      prisma,
      { userId: baseline.cfoUserId, reason: 'statutory stop' },
      true,
    );
    await expect(assertIssuanceEnabled(prisma)).rejects.toBeInstanceOf(
      IssuanceDisabledError,
    );
    const entries = await prisma.changeLogEntry.findMany({
      where: { subjectType: 'IssuanceKillSwitch' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.reason).toBe('statutory stop');
  });
});
