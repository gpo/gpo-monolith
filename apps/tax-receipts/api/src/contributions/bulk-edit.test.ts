import { InMemoryQomon } from '@gpo/qomon-client/fake';
import { beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import { issueReceipt, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import {
  BulkEditEmptyChangesError,
  BulkEditTooLargeError,
  bulkEditContributionMetadata,
} from './bulk-edit.js';

const prisma = testPrisma();

describe('bulkEditContributionMetadata (ticket 1.4)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let qomon: InMemoryQomon;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    qomon = new InMemoryQomon();
  });

  async function seedRow(qomonId: bigint, opts: { ridingNumber?: number | null; nonDeductibleCents?: number } = {}) {
    qomon.seedContact({ id: Number(qomonId), firstname: 'Dana', surname: 'Donor' });
    const bundle = qomon.seedBundle({
      transactions: [{ contact_id: Number(qomonId), amount: 5_000, date: '2026-03-01T00:00:00.000Z', status_id: 1 }],
    });
    const contact = await prisma.contact.create({ data: { qomonContactId: qomonId, name: 'Dana Donor' } });
    const contribution = await prisma.contribution.create({
      data: {
        contactId: contact.id,
        qomonTransactionId: BigInt(bundle.transactions[0]!.id),
        qomonBundleId: BigInt(bundle.id),
        amountCents: 5_000,
        acceptedAt: new Date('2026-03-01T00:00:00Z'),
      },
    });
    await withChangeLog(prisma, { userId: null, reason: 'fixture' }, async (ctx) => {
      const after = await ctx.tx.contributionMetadata.create({
        data: {
          contributionId: contribution.id,
          periodId: baseline.periodId,
          ridingNumber: opts.ridingNumber ?? null,
          entityKind: opts.ridingNumber ? 'CA' : 'PARTY',
          receivedBy: 'GPO',
          nonDeductibleCents: opts.nonDeductibleCents ?? 0,
          sourceCode: 'keep-me',
        },
      });
      await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contribution.id, after });
    });
    return contribution;
  }

  it('applies one field change across every row and leaves the rest untouched', async () => {
    const a = await seedRow(1n, { ridingNumber: 84 });
    const b = await seedRow(2n, { ridingNumber: 84 });

    const result = await bulkEditContributionMetadata(
      { prisma, qomon },
      {
        contributionIds: [a.id, b.id],
        actorUserId: baseline.adminUserId,
        reason: 'reassign period for the by-election window',
        changes: { periodId: 67 },
      },
    );

    expect(result).toMatchObject({ succeeded: 2, failed: 0 });
    for (const id of [a.id, b.id]) {
      const row = await prisma.contributionMetadata.findUnique({ where: { contributionId: id } });
      expect(row).toMatchObject({ periodId: 67, ridingNumber: 84, sourceCode: 'keep-me' });
    }

    const entries = await prisma.changeLogEntry.findMany({
      where: { subjectType: 'ContributionMetadata', reason: 'reassign period for the by-election window' },
    });
    expect(entries).toHaveLength(2); // one change-log entry per row
  });

  it('can set a nullable field to null explicitly (party-level reassignment)', async () => {
    const a = await seedRow(3n, { ridingNumber: 84 });
    await bulkEditContributionMetadata(
      { prisma, qomon },
      {
        contributionIds: [a.id],
        actorUserId: baseline.adminUserId,
        reason: 'move to party-level',
        changes: { ridingNumber: null, entityKind: 'PARTY' },
      },
    );
    const row = await prisma.contributionMetadata.findUnique({ where: { contributionId: a.id } });
    expect(row?.ridingNumber).toBeNull();
  });

  it('reports a per-row failure without stopping the rest of the batch', async () => {
    const a = await seedRow(4n, { ridingNumber: 84 });
    const contact = await prisma.contact.create({ data: { qomonContactId: 40n, name: 'No Metadata' } });
    const noMetadata = await prisma.contribution.create({
      data: { contactId: contact.id, qomonTransactionId: 40n, amountCents: 1, acceptedAt: new Date('2026-03-01T00:00:00Z') },
    });

    const result = await bulkEditContributionMetadata(
      { prisma, qomon },
      {
        contributionIds: [a.id, noMetadata.id],
        actorUserId: baseline.adminUserId,
        reason: 'batch with one bad row',
        changes: { periodId: 67 },
      },
    );

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results.find((r) => r.contributionId === a.id)?.ok).toBe(true);
    const failedRow = result.results.find((r) => r.contributionId === noMetadata.id);
    expect(failedRow?.ok).toBe(false);
    expect(failedRow?.error).toMatch(/no metadata/);
  });

  it('reports a per-row failure for a receipted row without touching it', async () => {
    const a = await seedRow(5n, { ridingNumber: 84 });
    await issueReceipt(prisma, {
      contactId: (await prisma.contribution.findUniqueOrThrow({ where: { id: a.id } })).contactId,
      contributionId: a.id,
      periodId: baseline.periodId,
      amountCents: 5_000,
      actorUserId: baseline.cfoUserId,
    });

    const result = await bulkEditContributionMetadata(
      { prisma, qomon },
      {
        contributionIds: [a.id],
        actorUserId: baseline.adminUserId,
        reason: 'attempt on a receipted row',
        changes: { periodId: 67 },
      },
    );
    expect(result.failed).toBe(1);
    const row = await prisma.contributionMetadata.findUnique({ where: { contributionId: a.id } });
    expect(row?.periodId).toBe(baseline.periodId); // untouched
  });

  it('rejects an empty changes object', async () => {
    const a = await seedRow(6n);
    await expect(
      bulkEditContributionMetadata(
        { prisma, qomon },
        { contributionIds: [a.id], actorUserId: baseline.adminUserId, reason: 'x', changes: {} },
      ),
    ).rejects.toBeInstanceOf(BulkEditEmptyChangesError);
  });

  it('rejects a batch larger than the row cap', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `fake-${i}`);
    await expect(
      bulkEditContributionMetadata(
        { prisma, qomon },
        { contributionIds: ids, actorUserId: baseline.adminUserId, reason: 'x', changes: { periodId: 1 } },
      ),
    ).rejects.toBeInstanceOf(BulkEditTooLargeError);
  });
});
