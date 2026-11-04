import { InMemoryQomon } from '@gpo/qomon-client/fake';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import type { BuildQomon } from '../qomon/settings.js';
import { resetDb, seedBaseline, testPrisma } from '../test/db.js';

const prisma = testPrisma();
const SECRET = 'test-session-secret-at-least-32-characters-long';

const SYSADMIN: [string, string] = ['sysadmin@gpo.test', 'sysadmin-pass-phrase'];
const ADMIN: [string, string] = ['admin@gpo.test', 'admin-pass-phrase'];

describe('Qomon settings (Admin > Qomon)', () => {
  let app: FastifyInstance;
  let built: { apiKey: string; apiBase: string }[];

  beforeEach(async () => {
    await resetDb(prisma);
    const baseline = await seedBaseline(prisma);
    await prisma.user.update({
      where: { id: baseline.adminUserId },
      data: { passwordHash: await hashPassword(ADMIN[1]) },
    });
    await prisma.user.create({
      data: { email: SYSADMIN[0], name: 'Sys Admin', roleKey: 'sysadmin', passwordHash: await hashPassword(SYSADMIN[1]), allRidings: true },
    });
    built = [];
    const buildQomon: BuildQomon = (config) => {
      built.push(config);
      return new InMemoryQomon();
    };
    app = await buildApp({ prisma, sessionSecret: SECRET, buildQomon });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function call(method: 'GET' | 'PUT', url: string, who: [string, string], payload?: object) {
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: who[0], password: who[1] } });
    const cookie = login.cookies[0]!;
    return app.inject({ method, url, cookies: { [cookie.name]: cookie.value }, ...(payload ? { payload } : {}) });
  }

  it('is off on a fresh database: contributors are tool-owned and no client is built', async () => {
    expect((await call('GET', '/admin/qomon-settings', SYSADMIN)).json()).toMatchObject({
      enabled: false,
      apiKeySet: false,
      apiBase: 'https://incoming.qomon.app',
    });
    expect((await call('GET', '/contacts/settings', ADMIN)).json()).toEqual({ source: 'tool' });
    expect(built).toEqual([]);
  });

  it('is read and written by the system administrator only', async () => {
    expect((await call('GET', '/admin/qomon-settings', ADMIN)).statusCode).toBe(403);
    const write = await call('PUT', '/admin/qomon-settings', ADMIN, { enabled: true, apiKey: 'k', reason: 'go live' });
    expect(write.statusCode).toBe(403);
  });

  it('refuses to enable Qomon without a key on file', async () => {
    const res = await call('PUT', '/admin/qomon-settings', SYSADMIN, { enabled: true, reason: 'go live' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/API key is required/);
  });

  it('takes effect on the next request without a restart, and never returns or logs the key', async () => {
    const saved = await call('PUT', '/admin/qomon-settings', SYSADMIN, {
      enabled: true,
      apiKey: 'secret-key-123',
      apiBase: 'https://staging.qomon.example',
      reason: 'connect the party space',
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ enabled: true, apiKeySet: true, apiBase: 'https://staging.qomon.example' });
    expect(saved.body).not.toContain('secret-key-123');

    expect((await call('GET', '/contacts/settings', ADMIN)).json()).toEqual({ source: 'qomon' });
    expect(built).toEqual([{ apiKey: 'secret-key-123', apiBase: 'https://staging.qomon.example' }]);

    const entries = await prisma.changeLogEntry.findMany({ where: { subjectType: 'QomonSettings' } });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.reason).toBe('connect the party space');
    expect(entries[0]!.after).toEqual({ enabled: true, apiBase: 'https://staging.qomon.example', apiKeySet: true });
    expect(JSON.stringify(entries)).not.toContain('secret-key-123');

    // disabling keeps the key on file, and contributors go back to the tool
    const off = await call('PUT', '/admin/qomon-settings', SYSADMIN, { enabled: false, reason: 'pause the sync' });
    expect(off.json()).toMatchObject({ enabled: false, apiKeySet: true });
    expect((await call('GET', '/contacts/settings', ADMIN)).json()).toEqual({ source: 'tool' });
  });

  it('builds the client once and rebuilds it only when the key changes', async () => {
    await call('PUT', '/admin/qomon-settings', SYSADMIN, { enabled: true, apiKey: 'first-key', reason: 'connect' });
    await call('GET', '/contacts/settings', ADMIN);
    await call('GET', '/contacts/settings', ADMIN);
    expect(built).toHaveLength(1);

    await call('PUT', '/admin/qomon-settings', SYSADMIN, { apiKey: 'rotated-key', reason: 'rotate the key' });
    await call('GET', '/contacts/settings', ADMIN);
    expect(built.map((b) => b.apiKey)).toEqual(['first-key', 'rotated-key']);
  });
});
