import { QomonNotFoundError, QomonTransportError } from '@gpo/qomon-client';
import { InMemoryQomon } from '@gpo/qomon-client/fake';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_QOMON_API_BASE } from '../qomon/settings.js';
import { resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { executeSweepTarget, SweepExecutionError } from './execute-target.js';

const prisma = testPrisma();
const party = { target: { kind: 'party' }, mode: 'incremental' } as const;

async function configureParty(
  apiKey = 'party-key',
  apiBase = 'https://party.example',
) {
  await prisma.qomonSettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', enabled: true, apiKey, apiBase },
    update: { enabled: true, apiKey, apiBase },
  });
}

describe('worker-safe sweep target execution', () => {
  beforeEach(async () => {
    await resetDb(prisma);
    await seedBaseline(prisma);
  });

  it('reads current party settings on every execution and returns the sweep summary', async () => {
    const qomon = new InMemoryQomon();
    qomon.seedContact({ id: 501, firstname: 'Party' });
    qomon.seedBundle({
      transactions: [
        { contact_id: 501, amount: 100, date: '2026-03-01', status_id: 1 },
      ],
    });
    const buildQomon = vi.fn(() => qomon);
    const deps = { prisma, buildQomon };
    await configureParty();
    expect(await executeSweepTarget(deps, party)).toMatchObject({
      mode: 'incremental',
      pulled: 1,
      created: 1,
      unchanged: 0,
      backfilled: 0,
      changedInQomon: 0,
      syncIncidents: 0,
      hasMore: false,
      cursor: { since: expect.any(String) },
      contactFetchFailures: [],
    });
    await configureParty('rotated-key', 'https://rotated.example');
    expect(
      await executeSweepTarget(deps, { ...party, mode: 'full' }),
    ).toMatchObject({
      mode: 'full',
      pulled: 1,
      unchanged: 1,
      created: 0,
    });
    expect(buildQomon.mock.calls).toEqual([
      [{ apiKey: 'party-key', apiBase: 'https://party.example' }],
      [{ apiKey: 'rotated-key', apiBase: 'https://rotated.example' }],
    ]);
    await prisma.qomonSettings.update({
      where: { id: 'singleton' },
      data: { enabled: false },
    });
    await expect(executeSweepTarget(deps, party)).rejects.toMatchObject({
      code: 'QOMON_DISABLED',
    });
    expect(buildQomon).toHaveBeenCalledTimes(2);
  });

  it('uses current riding keys and base URL overrides while isolating cursors', async () => {
    const buildQomon = vi.fn(() => new InMemoryQomon());
    const deps = { prisma, buildQomon };
    const riding = {
      target: { kind: 'riding', ridingNumber: 7 },
      mode: 'full',
    } as const;
    await prisma.riding.create({
      data: { ridingNumber: 7, name: 'Seven', qomonApiKey: 'riding-key' },
    });
    await executeSweepTarget(deps, riding);
    expect(buildQomon).toHaveBeenLastCalledWith({
      apiKey: 'riding-key',
      apiBase: DEFAULT_QOMON_API_BASE,
    });
    await configureParty();
    await executeSweepTarget(deps, { ...riding, mode: 'incremental' });
    expect(buildQomon).toHaveBeenLastCalledWith({
      apiKey: 'riding-key',
      apiBase: 'https://party.example',
    });
    await prisma.riding.update({
      where: { ridingNumber: 7 },
      data: {
        qomonApiKey: 'new-riding-key',
        qomonApiBase: 'https://riding.example',
      },
    });
    await executeSweepTarget(deps, riding);
    expect(buildQomon).toHaveBeenLastCalledWith({
      apiKey: 'new-riding-key',
      apiBase: 'https://riding.example',
    });
    const before = await prisma.syncCursor.findUnique({
      where: { feedKind: 'qomon-poll:riding-7' },
    });
    expect(before).not.toBeNull();
    expect(
      await prisma.syncCursor.findUnique({ where: { feedKind: 'qomon-poll' } }),
    ).toBeNull();
    await executeSweepTarget(deps, party);
    expect(
      await prisma.syncCursor.findUnique({
        where: { feedKind: 'qomon-poll:riding-7' },
      }),
    ).toEqual(before);
    expect(await prisma.syncCursor.count()).toBe(2);
  });

  it('returns typed unavailable-target errors without constructing clients', async () => {
    const buildQomon = vi.fn(() => new InMemoryQomon());
    const deps = { prisma, buildQomon };
    const riding = {
      target: { kind: 'riding', ridingNumber: 7 },
      mode: 'incremental',
    } as const;
    await expect(executeSweepTarget(deps, party)).rejects.toMatchObject({
      code: 'QOMON_DISABLED',
    });
    await expect(executeSweepTarget(deps, riding)).rejects.toMatchObject({
      code: 'UNKNOWN_RIDING',
    });
    await prisma.riding.create({
      data: { ridingNumber: 7, name: 'Seven', active: false, qomonApiKey: '' },
    });
    await expect(executeSweepTarget(deps, riding)).rejects.toMatchObject({
      code: 'INACTIVE_RIDING',
    });
    await prisma.riding.update({
      where: { ridingNumber: 7 },
      data: { active: true },
    });
    await expect(executeSweepTarget(deps, riding)).rejects.toMatchObject({
      code: 'MISSING_API_KEY',
    });
    await configureParty('   ');
    await expect(executeSweepTarget(deps, party)).rejects.toMatchObject({
      code: 'MISSING_API_KEY',
    });
    expect(buildQomon).not.toHaveBeenCalled();
    expect(await prisma.syncCursor.count()).toBe(0);
  });

  it('sanitizes execution failures while preserving retry classification', async () => {
    await configureParty('secret-key');
    const failure = new QomonTransportError('secret-key', {
      method: 'GET',
      path: '/',
      attempt: 1,
      body: 'secret-key',
    });
    const buildQomon = vi.fn(() => {
      throw failure;
    });
    let caught: unknown;
    try {
      await executeSweepTarget({ prisma, buildQomon }, party);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SweepExecutionError);
    expect(caught).toMatchObject({
      retryable: true,
      message: 'Qomon sweep execution failed',
    });
    expect(JSON.stringify(caught)).not.toContain('secret-key');
    expect(String(caught)).not.toContain('secret-key');
    expect(caught).not.toHaveProperty('cause');
    await expect(
      executeSweepTarget(
        {
          prisma,
          buildQomon: () => {
            throw new Error('secret-key');
          },
        },
        party,
      ),
    ).rejects.toMatchObject({ retryable: false });
  });

  it('redacts credentials from contact warnings without dropping successful imports', async () => {
    await configureParty('secret-key');
    const qomon = new InMemoryQomon();
    qomon.seedContact({ id: 501, firstname: 'Valid' });
    for (const contact_id of [501, 999]) {
      qomon.seedBundle({
        transactions: [
          { contact_id, amount: 100, date: '2026-03-01', status_id: 1 },
        ],
      });
    }
    const getContact = qomon.getContact.bind(qomon);
    vi.spyOn(qomon, 'getContact').mockImplementation(async (id) => {
      if (id === 999)
        throw new QomonNotFoundError('contact missing: secret-key', {
          method: 'GET',
          path: '/',
          attempt: 1,
        });
      return getContact(id);
    });
    const result = await executeSweepTarget(
      { prisma, buildQomon: () => qomon },
      party,
    );
    expect(result).toMatchObject({
      created: 1,
      pulled: 2,
      contactFetchFailures: [
        { qomonContactId: 999, message: 'contact missing: [redacted]' },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('secret-key');
  });
});
