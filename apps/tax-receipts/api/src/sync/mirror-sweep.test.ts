import { QomonPollChangeFeed } from '@gpo/qomon-client';
import { InMemoryQomon } from '@gpo/qomon-client/fake';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueReceipt, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { runMirrorSweep } from './mirror-sweep.js';

const prisma = testPrisma();

describe('mirror sweep (ticket 1.1, data-model §5)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
  });

  it('mirrors a new transaction, applies the 1.6-stub intake defaults, opens a validation work item, and fetches the contact on demand', async () => {
    const qomon = new InMemoryQomon();
    qomon.seedContact({ id: 501, firstname: 'Dana', surname: 'Donor', mail: 'dana@example.org' });
    qomon.seedBundle({
      transactions: [
        {
          contact_id: 501,
          amount: 5_000,
          currency: 'cad',
          date: '2026-03-01T12:00:00.000Z',
          status_id: 1, // "Valid" in the fake's default statuses
          code_campaign: 'NC.W.DON.DBK.BTN50',
        },
      ],
    });
    const feed = new QomonPollChangeFeed(qomon);

    const result = await runMirrorSweep({ prisma, feed, qomon });

    expect(result).toMatchObject({ created: 1, refreshed: 0, diffQueued: 0, unchanged: 0 });

    const contribution = await prisma.contribution.findFirst({
      include: { metadata: true, contact: true },
    });
    expect(contribution?.amountCents).toBe(5_000);
    expect(contribution?.statusKind).toBe('valid');
    expect(contribution?.contact.name).toBe('Dana Donor');
    expect(contribution?.metadata).toMatchObject({
      periodId: baseline.periodId,
      ridingNumber: null,
      entityKind: 'PARTY',
      receivedBy: 'GPO',
      sourceCode: 'NC.W.DON.DBK.BTN50',
      checksum: null, // stub default, never written to/confirmed against Qomon
    });

    // one intake-flag work item per ticket-1.6 field the stub couldn't derive
    // (period_id resolved fine, so it's absent here)
    const workItems = await prisma.workItem.findMany();
    expect(workItems).toHaveLength(3);
    expect(workItems.map((w) => w.ruleRef).sort()).toEqual([
      'INTAKE:entity_kind',
      'INTAKE:received_by',
      'INTAKE:riding_number',
    ]);
    expect(workItems.every((w) => w.kind === 'VALIDATION' && w.status === 'OPEN')).toBe(true);

    // the sweep's own metadata writes go through the guarded change-log path
    const entries = await prisma.changeLogEntry.findMany({ where: { subjectType: 'ContributionMetadata' } });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.actorUserId).toBeNull(); // system actor

    // a second transaction for the same Qomon contact reuses the local Contact row
    // (explicit far-future CreatedAt so the incremental cursor is guaranteed to pick it up)
    qomon.seedBundle({
      CreatedAt: '2030-01-01T00:00:00.000Z',
      UpdatedAt: '2030-01-01T00:00:00.000Z',
      transactions: [{ contact_id: 501, amount: 1_000, date: '2026-03-02T12:00:00.000Z', status_id: 1 }],
    });
    await runMirrorSweep({ prisma, feed, qomon });
    expect(await prisma.contact.count()).toBe(1);
    expect(await prisma.contribution.count()).toBe(2);
  });

  it('mirrors a new transaction without metadata when no period covers its acceptance date, and flags it', async () => {
    const qomon = new InMemoryQomon();
    qomon.seedContact({ id: 9, firstname: 'Out', surname: 'OfRange' });
    qomon.seedBundle({
      transactions: [{ contact_id: 9, amount: 100, date: '2019-01-01T00:00:00.000Z', status_id: 1 }],
    });
    const feed = new QomonPollChangeFeed(qomon);

    const result = await runMirrorSweep({ prisma, feed, qomon });
    expect(result.created).toBe(1);

    const contribution = await prisma.contribution.findFirst({ include: { metadata: true } });
    expect(contribution?.metadata).toBeNull();
    const workItems = await prisma.workItem.findMany({ where: { kind: 'VALIDATION' } });
    expect(workItems.map((w) => w.ruleRef).sort()).toEqual([
      'INTAKE:entity_kind',
      'INTAKE:period_id',
      'INTAKE:received_by',
      'INTAKE:riding_number',
    ]);
  });

  it('backfills metadata on a later sweep once a period is configured for a previously-unresolvable contribution', async () => {
    const qomon = new InMemoryQomon();
    qomon.seedContact({ id: 9, firstname: 'Out', surname: 'OfRange' });
    qomon.seedBundle({
      transactions: [{ contact_id: 9, amount: 100, date: '2020-06-15T00:00:00.000Z', status_id: 1 }],
      // bundle stays otherwise unchanged; only DB-side config (the new
      // period) changes between sweeps, so force a full re-scan to detect it
    });
    const feed = new QomonPollChangeFeed(qomon);
    await runMirrorSweep({ prisma, feed, qomon });
    let contribution = await prisma.contribution.findFirst({ include: { metadata: true } });
    expect(contribution?.metadata).toBeNull();

    await prisma.period.create({
      data: {
        id: 2020,
        name: '2020 Annual',
        kind: 'ANNUAL',
        startsAt: new Date('2020-01-01T05:00:00Z'),
        endsAt: new Date('2021-01-01T05:00:00Z'),
      },
    });

    // the underlying transaction didn't change, so only a full sweep (which
    // re-evaluates everything) will notice the metadata gap can now be filled
    await runMirrorSweep({ prisma, feed, qomon, }, { mode: 'full' });
    contribution = await prisma.contribution.findFirst({ include: { metadata: true } });
    expect(contribution?.metadata).toMatchObject({ periodId: 2020 });
  });

  it('refreshes the cache directly for a non-receipted, non-reported contribution that changed', async () => {
    const qomonA = new InMemoryQomon();
    qomonA.seedContact({ id: 10, firstname: 'Chris', surname: 'Contributor' });
    const bundle = qomonA.seedBundle({
      transactions: [{ contact_id: 10, amount: 2_000, date: '2026-04-01T00:00:00.000Z', status_id: 1 }],
    });
    const feedA = new QomonPollChangeFeed(qomonA);
    await runMirrorSweep({ prisma, feed: feedA, qomon: qomonA });

    await qomonA.patchTransactionBundle({
      id: bundle.id,
      transactions: [{ id: bundle.transactions[0]!.id, amount: 9_999 }],
    });
    const result = await runMirrorSweep({ prisma, feed: feedA, qomon: qomonA }, { mode: 'full' });
    expect(result).toMatchObject({ refreshed: 1, diffQueued: 0 });

    const contribution = await prisma.contribution.findFirst();
    expect(contribution?.amountCents).toBe(9_999);
    expect(await prisma.workItem.count({ where: { kind: 'DIFF' } })).toBe(0);
  });

  it('routes a change to a receipted contribution into the diff queue instead of overwriting it', async () => {
    const qomon = new InMemoryQomon();
    qomon.seedContact({ id: 11, firstname: 'Pat', surname: 'Payer' });
    const bundle = qomon.seedBundle({
      transactions: [{ contact_id: 11, amount: 10_000, date: '2026-05-01T00:00:00.000Z', status_id: 1 }],
    });
    const feed = new QomonPollChangeFeed(qomon);
    await runMirrorSweep({ prisma, feed, qomon });

    const contribution = await prisma.contribution.findFirstOrThrow();
    await issueReceipt(prisma, {
      contactId: contribution.contactId,
      contributionId: contribution.id,
      periodId: baseline.periodId,
      amountCents: 10_000,
      actorUserId: baseline.cfoUserId,
    });

    await qomon.patchTransactionBundle({
      id: bundle.id,
      transactions: [{ id: bundle.transactions[0]!.id, amount: 1 }],
    });
    const result = await runMirrorSweep({ prisma, feed, qomon }, { mode: 'full' });
    expect(result).toMatchObject({ diffQueued: 1, refreshed: 0 });

    // the mirror row is untouched: the correction workflow owns this change, not the sweep
    const unchanged = await prisma.contribution.findUniqueOrThrow({ where: { id: contribution.id } });
    expect(unchanged.amountCents).toBe(10_000);

    const diffItems = await prisma.workItem.findMany({ where: { kind: 'DIFF' } });
    expect(diffItems).toHaveLength(1);
    expect(diffItems[0]).toMatchObject({
      subjectType: 'Contribution',
      subjectId: contribution.id,
      status: 'OPEN',
    });

    // re-sweeping without resolving the diff does not pile up duplicate items
    await runMirrorSweep({ prisma, feed, qomon }, { mode: 'full' });
    expect(await prisma.workItem.count({ where: { kind: 'DIFF' } })).toBe(1);
  });

  it('flags a Qomon-side deletion as a sync incident, never a silent removal (invariant 4)', async () => {
    const qomonA = new InMemoryQomon();
    qomonA.seedContact({ id: 12, firstname: 'Gone', surname: 'Soon' });
    qomonA.seedBundle({
      transactions: [{ contact_id: 12, amount: 500, date: '2026-06-01T00:00:00.000Z', status_id: 1 }],
    });
    const feedA = new QomonPollChangeFeed(qomonA);
    await runMirrorSweep({ prisma, feed: feedA, qomon: qomonA });
    const contribution = await prisma.contribution.findFirstOrThrow();

    // a fresh, empty fake stands in for "Qomon no longer has this transaction"
    const qomonB = new InMemoryQomon();
    const feedB = new QomonPollChangeFeed(qomonB);
    const result = await runMirrorSweep({ prisma, feed: feedB, qomon: qomonB }, { mode: 'full' });
    expect(result.syncIncidents).toBe(1);

    const after = await prisma.contribution.findUniqueOrThrow({ where: { id: contribution.id } });
    expect(after.deletedInQomonAt).not.toBeNull();
    const incidents = await prisma.workItem.findMany({ where: { kind: 'SYNC_INCIDENT' } });
    expect(incidents).toHaveLength(1);
  });

  it('is idempotent across incremental sweeps: nothing new means nothing pulled, using the persisted cursor', async () => {
    const qomon = new InMemoryQomon();
    qomon.seedContact({ id: 13, firstname: 'Steady', surname: 'State' });
    qomon.seedBundle({
      transactions: [{ contact_id: 13, amount: 750, date: '2026-07-01T00:00:00.000Z', status_id: 1 }],
    });
    const feed = new QomonPollChangeFeed(qomon);

    const first = await runMirrorSweep({ prisma, feed, qomon });
    expect(first.created).toBe(1);
    expect(await prisma.syncCursor.findUnique({ where: { feedKind: 'qomon-poll' } })).not.toBeNull();

    const second = await runMirrorSweep({ prisma, feed, qomon });
    expect(second).toMatchObject({ pulled: 0, created: 0, refreshed: 0, diffQueued: 0, unchanged: 0 });
  });

  it('caches metadata directly from an already-present Qomon `metadata` field on first sight, deriving nothing', async () => {
    const qomon = new InMemoryQomon();
    qomon.seedContact({ id: 14, firstname: 'Al', surname: 'Ready' });
    qomon.seedBundle({
      transactions: [
        {
          contact_id: 14,
          amount: 3_000,
          date: '2026-03-05T00:00:00.000Z',
          status_id: 1,
          metadata: {
            v: 1,
            gpo: {
              period_id: baseline.periodId,
              riding_number: 84,
              entity_kind: 'CA',
              received_by: 'ENTITY',
              goods_services: false,
              non_deductible_cents: 0,
              processed_date: null,
              source_code: 'subspace:84',
              eo_contributor_id: null,
              exception_reason: null,
              external_ref: null,
            },
          },
        },
      ],
    });
    const feed = new QomonPollChangeFeed(qomon);
    await runMirrorSweep({ prisma, feed, qomon });

    const contribution = await prisma.contribution.findFirst({ include: { metadata: true } });
    expect(contribution?.metadata).toMatchObject({
      ridingNumber: 84,
      entityKind: 'CA',
      receivedBy: 'ENTITY',
      sourceCode: 'subspace:84',
    });
    expect(contribution?.metadata?.checksum).not.toBeNull();
  });
});
