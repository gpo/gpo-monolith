import { QomonPollChangeFeed } from '@gpo/qomon-client';
import { InMemoryQomon } from '@gpo/qomon-client/fake';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueReceipt, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { runMirrorSweep } from './mirror-sweep.js';

const prisma = testPrisma();

describe('Qomon import sweep (ticket 1.1, D12, data-model §5)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
  });

  it('imports a new transaction as a payment + link + contribution, applies the 1.6-stub intake defaults, opens a validation work item, and fetches the contact on demand', async () => {
    const qomon = new InMemoryQomon();
    qomon.seedContact({
      id: 501,
      firstname: 'Dana',
      surname: 'Donor',
      mail: 'dana@example.org',
      // a complete address so this sweep's validation run doesn't also open
      // a C1 (address-complete) work item alongside the intake flags below
      address: { housenumber: '123', street: 'Main St', city: 'Toronto', state: 'ON', postalcode: 'M5V 2T6', country: 'CA' },
    });
    qomon.seedBundle({
      transactions: [
        {
          contact_id: 501,
          amount: 5_000,
          currency: 'cad',
          date: '2026-03-01T12:00:00.000Z',
          status_id: 1, // "Valid" in the fake's default statuses
          payment_method_kind: 'CHE',
          code_campaign: 'NC.W.DON.DBK.BTN50',
        },
      ],
    });
    const feed = new QomonPollChangeFeed(qomon);

    const result = await runMirrorSweep({ prisma, feed, qomon });

    expect(result).toMatchObject({ created: 1, backfilled: 0, changedInQomon: 0, unchanged: 0 });

    const contribution = await prisma.contribution.findFirst({
      include: { contact: true, payment: { include: { qomonLink: true } } },
    });
    expect(contribution?.amountCents).toBe(5_000);
    expect(contribution?.status).toBe('ACTIVE');
    // the money fact lives on the payment, mapped from Qomon's vocabulary
    expect(contribution?.payment).toMatchObject({
      source: 'QOMON_IMPORT',
      amountCents: 5_000,
      method: 'CHEQUE',
      state: 'RECEIVED',
      contactId: contribution?.contactId,
    });
    // Qomon provenance lives on the link, raw values preserved
    expect(contribution?.payment.qomonLink).toMatchObject({
      qomonPaymentMethodKind: 'CHE',
      codeCampaign: 'NC.W.DON.DBK.BTN50',
      deletedInQomonAt: null,
    });
    expect(contribution?.contact.name).toBe('Dana Donor');
    // the descriptive fields are columns on the contribution itself (D12)
    expect(contribution).toMatchObject({
      periodId: baseline.periodId,
      ridingNumber: null,
      entityKind: 'PARTY',
      receivedBy: 'GPO',
      sourceCode: 'NC.W.DON.DBK.BTN50',
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

    // the import's writes go through the guarded change-log path, one entry
    // per created row, all in one cascade
    const entries = await prisma.changeLogEntry.findMany();
    expect(entries.map((e) => e.subjectType).sort()).toEqual(['Contribution', 'Payment']);
    expect(new Set(entries.map((e) => e.correlationId)).size).toBe(1);
    expect(entries.every((e) => e.actorUserId === null)).toBe(true); // system actor
    expect(contribution?.correlationId).toBe(entries[0]?.correlationId);

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

  it('skips a transaction whose contact 404s in Qomon instead of failing the whole sweep, and still mirrors the rest', async () => {
    const qomon = new InMemoryQomon();
    qomon.seedContact({ id: 501, firstname: 'Dana', surname: 'Donor', mail: 'dana@example.org' });
    qomon.seedBundle({
      transactions: [
        // 999 is never seeded: Qomon 404s it, e.g. the contact was deleted
        // after the transaction was created.
        { contact_id: 999, amount: 2_500, date: '2026-03-01T12:00:00.000Z', status_id: 1 },
      ],
    });
    qomon.seedBundle({
      CreatedAt: '2026-03-02T00:00:00.000Z',
      UpdatedAt: '2026-03-02T00:00:00.000Z',
      transactions: [{ contact_id: 501, amount: 5_000, date: '2026-03-02T12:00:00.000Z', status_id: 1 }],
    });
    const feed = new QomonPollChangeFeed(qomon);

    const result = await runMirrorSweep({ prisma, feed, qomon });

    expect(result.created).toBe(1);
    expect(result.contactFetchFailures).toEqual([
      { qomonTransactionId: expect.any(String), qomonContactId: 999, message: expect.stringContaining('contact not found') },
    ]);
    expect(await prisma.contribution.count()).toBe(1);
    expect((await prisma.contribution.findFirst())?.amountCents).toBe(5_000);
  });

  it('imports a new transaction with no period when none covers its acceptance date, and flags it', async () => {
    const qomon = new InMemoryQomon();
    qomon.seedContact({ id: 9, firstname: 'Out', surname: 'OfRange' });
    qomon.seedBundle({
      transactions: [{ contact_id: 9, amount: 100, date: '2019-01-01T00:00:00.000Z', status_id: 1 }],
    });
    const feed = new QomonPollChangeFeed(qomon);

    const result = await runMirrorSweep({ prisma, feed, qomon });
    expect(result.created).toBe(1);

    const contribution = await prisma.contribution.findFirst();
    expect(contribution?.periodId).toBeNull(); // no period yet: awaiting intake derivation
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
    let contribution = await prisma.contribution.findFirst();
    expect(contribution?.periodId).toBeNull();

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
    contribution = await prisma.contribution.findFirst();
    expect(contribution).toMatchObject({ periodId: 2020 });
  });

  it('records a Qomon-side edit on the link and opens one sync incident, changing nothing local (D12, O47)', async () => {
    const qomon = new InMemoryQomon();
    qomon.seedContact({ id: 10, firstname: 'Chris', surname: 'Contributor' });
    const bundle = qomon.seedBundle({
      transactions: [{ contact_id: 10, amount: 2_000, date: '2026-04-01T00:00:00.000Z', status_id: 1 }],
    });
    const feed = new QomonPollChangeFeed(qomon);
    await runMirrorSweep({ prisma, feed, qomon });
    const before = await prisma.qomonTransactionLink.findFirstOrThrow();

    await qomon.patchTransactionBundle({
      id: bundle.id,
      transactions: [{ id: bundle.transactions[0]!.id, amount: 9_999 }],
    });
    const result = await runMirrorSweep({ prisma, feed, qomon }, { mode: 'full' });
    expect(result).toMatchObject({ changedInQomon: 1, backfilled: 0, created: 0 });

    // the payment and contribution are exactly as imported
    const contribution = await prisma.contribution.findFirstOrThrow({ include: { payment: true } });
    expect(contribution.amountCents).toBe(2_000);
    expect(contribution.payment.amountCents).toBe(2_000);
    // the link moved its hash forward, so the same edit is not re-detected
    const after = await prisma.qomonTransactionLink.findFirstOrThrow();
    expect(after.syncHash).not.toBe(before.syncHash);

    const incidents = await prisma.workItem.findMany({ where: { kind: 'SYNC_INCIDENT' } });
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ subjectType: 'Payment', subjectId: contribution.paymentId, status: 'OPEN' });

    // sweeping again with no further edit finds nothing new
    const again = await runMirrorSweep({ prisma, feed, qomon }, { mode: 'full' });
    expect(again).toMatchObject({ changedInQomon: 0, unchanged: 1 });

    // a second edit before anyone resolves the first does not pile up incidents
    await qomon.patchTransactionBundle({
      id: bundle.id,
      transactions: [{ id: bundle.transactions[0]!.id, amount: 1 }],
    });
    await runMirrorSweep({ prisma, feed, qomon }, { mode: 'full' });
    expect(await prisma.workItem.count({ where: { kind: 'SYNC_INCIDENT' } })).toBe(1);
  });

  it('leaves a receipted contribution and its receipt untouched when Qomon later edits the transaction', async () => {
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
    expect(result).toMatchObject({ changedInQomon: 1 });

    // corrections happen only in the tool: the issued receipt still backs the full amount
    const unchanged = await prisma.contribution.findUniqueOrThrow({ where: { id: contribution.id } });
    expect(unchanged.amountCents).toBe(10_000);
    expect(await prisma.receipt.count({ where: { status: 'ISSUED' } })).toBe(1);
    expect(await prisma.workItem.count({ where: { kind: 'SYNC_INCIDENT', status: 'OPEN' } })).toBe(1);
    // and no legacy diff-queue item: attribution is not read from Qomon anymore
    expect(await prisma.workItem.count({ where: { kind: 'DIFF' } })).toBe(0);
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

    // only the link is flagged: the payment and its contributions are untouched (invariant 4, D12)
    const link = await prisma.qomonTransactionLink.findFirstOrThrow();
    expect(link.deletedInQomonAt).not.toBeNull();
    const after = await prisma.contribution.findUniqueOrThrow({ where: { id: contribution.id } });
    expect(after.status).toBe('ACTIVE');
    const incidents = await prisma.workItem.findMany({ where: { kind: 'SYNC_INCIDENT' } });
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ subjectType: 'Payment', subjectId: after.paymentId });
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
    expect(second).toMatchObject({ pulled: 0, created: 0, backfilled: 0, changedInQomon: 0, unchanged: 0 });
  });

  it('takes the six Qomon-synced fields from an already-present `extra_json` at import, defaulting the tool-local fields (period_id/riding_number/entity_kind/goods_services/processed_date/source_code sync through Qomon; received_by/non_deductible_cents/eo_contributor_id/exception_reason/external_ref do not)', async () => {
    const qomon = new InMemoryQomon();
    qomon.seedContact({ id: 14, firstname: 'Al', surname: 'Ready' });
    qomon.seedBundle({
      transactions: [
        {
          contact_id: 14,
          amount: 3_000,
          date: '2026-03-05T00:00:00.000Z',
          status_id: 1,
          extra_json: {
            'Source Code': 'subspace:84',
            'Accounting Deposit Date': null,
            'EO Contribution Period': String(baseline.periodId),
            'Contribution Type': 'Monetary',
            'Political Entity Type': 'Association',
            'Electoral District (Riding) Number': '084',
          },
        },
      ],
    });
    const feed = new QomonPollChangeFeed(qomon);
    await runMirrorSweep({ prisma, feed, qomon });

    const contribution = await prisma.contribution.findFirst();
    expect(contribution).toMatchObject({
      ridingNumber: 84,
      entityKind: 'CA',
      sourceCode: 'subspace:84',
      // no Qomon counterpart exists for received_by; defaults GPO same as
      // intake-derivation (intake/defaults.ts), not read from extra_json
      receivedBy: 'GPO',
    });
  });
});
