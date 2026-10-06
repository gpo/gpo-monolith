import { InMemoryQomon } from '@gpo/qomon-client/fake';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { fixtureContact, resetDb, seedBaseline, testPrisma } from '../test/db.js';

const prisma = testPrisma();
const SECRET = 'test-session-secret-at-least-32-characters-long';

const ADMIN: [string, string] = ['admin@gpo.test', 'admin-pass-phrase'];
const READONLY: [string, string] = ['readonly@gpo.test', 'readonly-pass-phrase'];

const NEW_DONOR = {
  reason: 'cheque from a first-time donor',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.org',
  address: { housenumber: '12', street: 'Queen St', city: 'Guelph', state: 'ON', postalcode: 'N1H 1A1', country: 'CA' },
};

describe('contributor routes (D13)', () => {
  let app: FastifyInstance;
  let qomon: InMemoryQomon | undefined;

  async function start(withQomon: boolean) {
    qomon = withQomon ? new InMemoryQomon() : undefined;
    app = await buildApp({ prisma, sessionSecret: SECRET, artifactStorageDir: '/tmp/unused', qomon });
    await app.ready();
  }

  beforeEach(async () => {
    await resetDb(prisma);
    const baseline = await seedBaseline(prisma);
    await prisma.user.update({
      where: { id: baseline.adminUserId },
      data: { passwordHash: await hashPassword(ADMIN[1]) },
    });
    await prisma.user.create({
      data: { email: READONLY[0], name: 'Reader', roleKey: 'readonly', passwordHash: await hashPassword(READONLY[1]), allRidings: true },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  async function call(method: 'GET' | 'POST' | 'PATCH', url: string, who: [string, string], payload?: object) {
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: who[0], password: who[1] } });
    const cookie = login.cookies[0]!;
    return app.inject({ method, url, cookies: { [cookie.name]: cookie.value }, ...(payload ? { payload } : {}) });
  }

  it('without Qomon: adds a tool-owned contributor, shows it with its change log, and edits it', async () => {
    await start(false);
    expect((await call('GET', '/contacts/settings', ADMIN)).json()).toEqual({ source: 'tool' });

    const created = await call('POST', '/contacts', ADMIN, NEW_DONOR);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      name: 'Ada Lovelace',
      source: 'tool',
      qomonContactId: null,
      contributorType: 'INDIVIDUAL',
      formattedAddress: { line1: '12 Queen St', city: 'Guelph', province: 'ON', postalCode: 'N1H 1A1' },
    });
    const id = created.json().id as string;

    const edited = await call('PATCH', `/contacts/${id}`, ADMIN, { ...NEW_DONOR, reason: 'new email', email: 'ada@new.example.org' });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().email).toBe('ada@new.example.org');

    const detail = await call('GET', `/contacts/${id}`, READONLY);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ editable: true, contributions: [] });
    expect(detail.json().changeLog.map((e: { reason: string; actorName: string }) => [e.reason, e.actorName])).toEqual([
      ['new email', 'Admin'],
      ['cheque from a first-time donor', 'Admin'],
    ]);

    const search = await call('GET', '/contacts?query=lovel', READONLY);
    expect(search.json().data).toEqual([expect.objectContaining({ id, name: 'Ada Lovelace', qomonContactId: null })]);
  });

  it('with Qomon: creates the contributor in Qomon first and reports its Qomon id', async () => {
    await start(true);
    expect((await call('GET', '/contacts/settings', ADMIN)).json()).toEqual({ source: 'qomon' });

    const created = await call('POST', '/contacts', ADMIN, NEW_DONOR);
    expect(created.statusCode).toBe(201);
    expect(created.json().source).toBe('qomon');
    const qomonId = Number(created.json().qomonContactId);
    expect(await qomon!.getContact(qomonId)).toMatchObject({ firstname: 'Ada', surname: 'Lovelace' });
  });

  it('a Qomon contact cannot be edited when Qomon is not configured', async () => {
    await start(false);
    const linked = await fixtureContact(prisma, { data: { name: 'Q Donor', firstName: 'Q', lastName: 'Donor', qomonContactId: 9n } });
    const detail = await call('GET', `/contacts/${linked.id}`, ADMIN);
    expect(detail.json()).toMatchObject({ source: 'qomon', editable: false });
    const res = await call('PATCH', `/contacts/${linked.id}`, ADMIN, NEW_DONOR);
    expect(res.statusCode).toBe(409);
  });

  it('needs contact.manage to add or edit, a reason, and a valid email', async () => {
    await start(false);
    expect((await call('POST', '/contacts', READONLY, NEW_DONOR)).statusCode).toBe(403);
    const { reason: _r, ...noReason } = NEW_DONOR;
    void _r;
    expect((await call('POST', '/contacts', ADMIN, noReason)).statusCode).toBe(400);
    expect((await call('POST', '/contacts', ADMIN, { ...NEW_DONOR, email: 'not-an-email' })).statusCode).toBe(400);
    // a blank email is no email
    const blank = await call('POST', '/contacts', ADMIN, { ...NEW_DONOR, email: '' });
    expect(blank.statusCode).toBe(201);
    expect(blank.json().email).toBeNull();
    expect((await call('PATCH', `/contacts/${blank.json().id}`, READONLY, NEW_DONOR)).statusCode).toBe(403);
  });

  it('tells the web app who may add and edit contributors', async () => {
    await start(false);
    expect((await call('GET', '/auth/me', ADMIN)).json().can).toMatchObject({ addContacts: true, editContacts: true });
    expect((await call('GET', '/auth/me', READONLY)).json().can).toMatchObject({ addContacts: false, editContacts: false });
  });
});
