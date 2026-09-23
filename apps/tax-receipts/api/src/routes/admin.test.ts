import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { resetDb, seedBaseline, testPrisma } from '../test/db.js';

const prisma = testPrisma();
const SECRET = 'test-session-secret-at-least-32-characters-long';

describe('admin routes (ticket 1.12)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb(prisma);
    const baseline = await seedBaseline(prisma);
    await prisma.user.update({
      where: { id: baseline.adminUserId },
      data: { passwordHash: await hashPassword('admin-pass-phrase') },
    });
    await prisma.user.create({
      data: {
        email: 'sysadmin@gpo.test',
        name: 'Sys Admin',
        role: 'sysadmin',
        passwordHash: await hashPassword('sysadmin-pass-phrase'),
        allRidings: true,
      },
    });
    app = await buildApp({ prisma, sessionSecret: SECRET });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function login(email: string, password: string) {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    return res.cookies[0]!;
  }

  it('rejects an administrator (non-sysadmin) from writing periods, but allows reading', async () => {
    const cookie = await login('admin@gpo.test', 'admin-pass-phrase');
    const read = await app.inject({ method: 'GET', url: '/admin/periods', cookies: { [cookie.name]: cookie.value } });
    expect(read.statusCode).toBe(200);

    const write = await app.inject({
      method: 'PUT',
      url: '/admin/periods/2020',
      cookies: { [cookie.name]: cookie.value },
      payload: { name: '2020 Annual', kind: 'ANNUAL', startsAt: '2020-01-01T05:00:00Z', endsAt: '2021-01-01T05:00:00Z' },
    });
    expect(write.statusCode).toBe(403);
  });

  it('a sysadmin can create a period, which re-runs validation', async () => {
    const cookie = await login('sysadmin@gpo.test', 'sysadmin-pass-phrase');
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/periods/2020',
      cookies: { [cookie.name]: cookie.value },
      payload: { name: '2020 Annual', kind: 'ANNUAL', startsAt: '2020-01-01T05:00:00Z', endsAt: '2021-01-01T05:00:00Z' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().period).toMatchObject({ id: 2020, name: '2020 Annual' });
    expect(res.json().revalidation).toMatchObject({ contributionsChecked: 0 });
    expect(await prisma.period.findUnique({ where: { id: 2020 } })).not.toBeNull();
  });

  it('a sysadmin can upsert and delete a contribution limit', async () => {
    const cookie = await login('sysadmin@gpo.test', 'sysadmin-pass-phrase');
    const put = await app.inject({
      method: 'PUT',
      url: '/admin/contribution-limits',
      cookies: { [cookie.name]: cookie.value },
      payload: { year: 2027, bucket: 'PARTY', amountCents: 500_000 },
    });
    expect(put.statusCode).toBe(200);
    const id = put.json().id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/admin/contribution-limits/${id}`,
      cookies: { [cookie.name]: cookie.value },
    });
    expect(del.statusCode).toBe(204);
    expect(await prisma.contributionLimit.findUnique({ where: { id } })).toBeNull();
  });

  it('a sysadmin can set a business-day calendar', async () => {
    const cookie = await login('sysadmin@gpo.test', 'sysadmin-pass-phrase');
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/business-day-calendars/2028',
      cookies: { [cookie.name]: cookie.value },
      payload: { holidays: ['2028-01-01', '2028-07-01'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().holidays).toEqual(['2028-01-01', '2028-07-01']);
  });

  it('a sysadmin can create and update a user', async () => {
    const cookie = await login('sysadmin@gpo.test', 'sysadmin-pass-phrase');
    const create = await app.inject({
      method: 'POST',
      url: '/admin/users',
      cookies: { [cookie.name]: cookie.value },
      payload: {
        name: 'New Filer',
        email: 'new-filer@gpo.test',
        password: 'a-long-enough-password',
        role: 'filer',
      },
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().id;

    const update = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${id}`,
      cookies: { [cookie.name]: cookie.value },
      payload: { isCfoDesignate: true, ridingGrants: [84] },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({ isCfoDesignate: true, ridingGrants: [84] });
  });

  it('requires authentication for every admin GET route', async () => {
    for (const url of ['/admin/periods', '/admin/contribution-limits', '/admin/business-day-calendars', '/admin/users', '/admin/ridings', '/admin/donor-prechecks']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(401);
    }
  });

  it('rejects an administrator (non-sysadmin) from writing ridings, but allows reading', async () => {
    const cookie = await login('admin@gpo.test', 'admin-pass-phrase');
    const read = await app.inject({ method: 'GET', url: '/admin/ridings', cookies: { [cookie.name]: cookie.value } });
    expect(read.statusCode).toBe(200);

    const write = await app.inject({
      method: 'PUT',
      url: '/admin/ridings/7',
      cookies: { [cookie.name]: cookie.value },
      payload: { name: 'Test Riding', qomonApiKey: 'secret-key' },
    });
    expect(write.statusCode).toBe(403);
  });

  it('a sysadmin can upsert and delete a riding, and the api key never round-trips', async () => {
    const cookie = await login('sysadmin@gpo.test', 'sysadmin-pass-phrase');
    const put = await app.inject({
      method: 'PUT',
      url: '/admin/ridings/7',
      cookies: { [cookie.name]: cookie.value },
      payload: { name: 'Test Riding', qomonApiKey: 'secret-key' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ ridingNumber: 7, name: 'Test Riding', active: true, qomonApiKeySet: true });
    expect(put.json().qomonApiKey).toBeUndefined();

    const list = await app.inject({ method: 'GET', url: '/admin/ridings', cookies: { [cookie.name]: cookie.value } });
    expect(list.json().data).toContainEqual(
      expect.objectContaining({ ridingNumber: 7, name: 'Test Riding', qomonApiKeySet: true }),
    );
    expect(JSON.stringify(list.json())).not.toContain('secret-key');

    const del = await app.inject({
      method: 'DELETE',
      url: '/admin/ridings/7',
      cookies: { [cookie.name]: cookie.value },
    });
    expect(del.statusCode).toBe(204);
    expect(await prisma.riding.findUnique({ where: { ridingNumber: 7 } })).toBeNull();
  });

  it('requires an api key for an active riding, but allows an inactive one without one', async () => {
    const cookie = await login('sysadmin@gpo.test', 'sysadmin-pass-phrase');

    const missingKey = await app.inject({
      method: 'PUT',
      url: '/admin/ridings/8',
      cookies: { [cookie.name]: cookie.value },
      payload: { name: 'Test Riding', qomonApiKey: '' },
    });
    expect(missingKey.statusCode).toBe(400);

    const inactiveNoKey = await app.inject({
      method: 'PUT',
      url: '/admin/ridings/8',
      cookies: { [cookie.name]: cookie.value },
      payload: { name: 'Test Riding', qomonApiKey: '', active: false },
    });
    expect(inactiveNoKey.statusCode).toBe(200);
    expect(inactiveNoKey.json()).toMatchObject({ ridingNumber: 8, active: false, qomonApiKeySet: false });
  });

  it('treats a whitespace-only api key as not set, for both an active riding and qomonApiKeySet', async () => {
    const cookie = await login('sysadmin@gpo.test', 'sysadmin-pass-phrase');

    const whitespaceKeyActive = await app.inject({
      method: 'PUT',
      url: '/admin/ridings/10',
      cookies: { [cookie.name]: cookie.value },
      payload: { name: 'Test Riding', qomonApiKey: '   ' },
    });
    expect(whitespaceKeyActive.statusCode).toBe(400);

    const whitespaceKeyInactive = await app.inject({
      method: 'PUT',
      url: '/admin/ridings/10',
      cookies: { [cookie.name]: cookie.value },
      payload: { name: 'Test Riding', qomonApiKey: '   ', active: false },
    });
    expect(whitespaceKeyInactive.statusCode).toBe(200);
    expect(whitespaceKeyInactive.json()).toMatchObject({ qomonApiKeySet: false });
    expect(await prisma.riding.findUnique({ where: { ridingNumber: 10 } })).toMatchObject({ qomonApiKey: '' });
  });

  it('PATCH leaves the api key in place when omitted, and blocks activating a riding with no key on file', async () => {
    const cookie = await login('sysadmin@gpo.test', 'sysadmin-pass-phrase');
    const put = await app.inject({
      method: 'PUT',
      url: '/admin/ridings/9',
      cookies: { [cookie.name]: cookie.value },
      payload: { name: 'Test Riding', qomonApiKey: 'secret-key' },
    });
    expect(put.statusCode).toBe(200);

    const renameOnly = await app.inject({
      method: 'PATCH',
      url: '/admin/ridings/9',
      cookies: { [cookie.name]: cookie.value },
      payload: { name: 'Renamed Riding' },
    });
    expect(renameOnly.statusCode).toBe(200);
    expect(renameOnly.json()).toMatchObject({ name: 'Renamed Riding', qomonApiKeySet: true });

    // clearing the key outright is only reachable via PUT, since an inactive
    // riding may be saved with no key on file
    const clearKeyAndDeactivate = await app.inject({
      method: 'PUT',
      url: '/admin/ridings/9',
      cookies: { [cookie.name]: cookie.value },
      payload: { name: 'Renamed Riding', qomonApiKey: '', active: false },
    });
    expect(clearKeyAndDeactivate.statusCode).toBe(200);
    expect(clearKeyAndDeactivate.json()).toMatchObject({ active: false, qomonApiKeySet: false });

    const reactivateNoKey = await app.inject({
      method: 'PATCH',
      url: '/admin/ridings/9',
      cookies: { [cookie.name]: cookie.value },
      payload: { active: true },
    });
    expect(reactivateNoKey.statusCode).toBe(400);
  });

  it('lists the donor pre-check outbox for a sysadmin only (ticket 3.9)', async () => {
    const contact = await prisma.contact.create({
      data: { qomonContactId: 999n, name: 'Pending Pat', email: 'pat@example.org' },
    });
    await prisma.donorCyclePreference.create({
      data: {
        contactId: contact.id,
        year: 2028,
        precheckSentAt: new Date(),
        confirmationToken: 'outbox-test-token',
        confirmationTokenExpiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const unauth = await app.inject({ method: 'GET', url: '/admin/donor-prechecks' });
    expect(unauth.statusCode).toBe(401);

    const adminCookie = await login('admin@gpo.test', 'admin-pass-phrase');
    const forbidden = await app.inject({
      method: 'GET',
      url: '/admin/donor-prechecks',
      cookies: { [adminCookie.name]: adminCookie.value },
    });
    expect(forbidden.statusCode).toBe(403);

    const sysadminCookie = await login('sysadmin@gpo.test', 'sysadmin-pass-phrase');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/donor-prechecks',
      cookies: { [sysadminCookie.name]: sysadminCookie.value },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject([
      { contactId: contact.id, contactName: 'Pending Pat', confirmationToken: 'outbox-test-token' },
    ]);
  });

  it('rejects an administrator (non-sysadmin) from importing ridings', async () => {
    const cookie = await login('admin@gpo.test', 'admin-pass-phrase');
    const res = await app.inject({
      method: 'POST',
      url: '/admin/ridings/import',
      cookies: { [cookie.name]: cookie.value },
      payload: [{ ridingNumber: 1, name: 'Ajax', qomonApiKey: '', qomonApiBase: null, active: true }],
    });
    expect(res.statusCode).toBe(403);
  });

  it('a sysadmin can bulk-import a riding directory with blank keys, without duplicating on re-import', async () => {
    const cookie = await login('sysadmin@gpo.test', 'sysadmin-pass-phrase');

    const rows = [
      { ridingNumber: 1, name: 'Ajax', qomonApiKey: '', qomonApiBase: null, active: true, effectiveFrom: '2018-06-07T00:00:00.000Z' },
      { ridingNumber: 2, name: 'Algoma—Manitoulin', qomonApiKey: '', qomonApiBase: null, active: true },
    ];

    const first = await app.inject({
      method: 'POST',
      url: '/admin/ridings/import',
      cookies: { [cookie.name]: cookie.value },
      payload: rows,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ imported: 2, created: 2, updated: 0 });
    expect(first.json().data).toContainEqual(
      expect.objectContaining({ ridingNumber: 1, name: 'Ajax', active: true, qomonApiKeySet: false }),
    );
    // effectiveFrom isn't a schema field — accepted, then dropped, not invented
    expect(first.json().data[0]).not.toHaveProperty('effectiveFrom');

    const renamed = [{ ...rows[0], name: 'Ajax Renamed' }, rows[1]];
    const second = await app.inject({
      method: 'POST',
      url: '/admin/ridings/import',
      cookies: { [cookie.name]: cookie.value },
      payload: renamed,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ imported: 2, created: 0, updated: 2 });
    expect(await prisma.riding.count()).toBe(2);
    expect(await prisma.riding.findUnique({ where: { ridingNumber: 1 } })).toMatchObject({ name: 'Ajax Renamed' });
  });

  it('import leaves an existing Qomon key in place when the file has a blank key for that riding', async () => {
    const cookie = await login('sysadmin@gpo.test', 'sysadmin-pass-phrase');
    await app.inject({
      method: 'PUT',
      url: '/admin/ridings/7',
      cookies: { [cookie.name]: cookie.value },
      payload: { name: 'Test Riding', qomonApiKey: 'secret-key' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/admin/ridings/import',
      cookies: { [cookie.name]: cookie.value },
      payload: [{ ridingNumber: 7, name: 'Test Riding Renamed', qomonApiKey: '', qomonApiBase: null, active: true }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0]).toMatchObject({ name: 'Test Riding Renamed', qomonApiKeySet: true });
    expect(await prisma.riding.findUnique({ where: { ridingNumber: 7 } })).toMatchObject({ qomonApiKey: 'secret-key' });
  });
});
