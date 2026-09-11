import { InMemoryQomon } from '@gpo/qomon-client/fake';
import { computeMetadataChecksum, type GpoMetadataDescriptive } from '@gpo/tax-receipts-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueReceipt, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import {
  ContributionNotFoundError,
  MetadataWriteBlockedError,
  QomonWriteRejectedError,
  QomonWriteUnconfirmedError,
  writeContributionMetadata,
} from './metadata-write-through.js';

const prisma = testPrisma();

function descriptive(overrides: Partial<GpoMetadataDescriptive> = {}): GpoMetadataDescriptive {
  return {
    period_id: 67,
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
    ...overrides,
  };
}

describe('metadata write-through (ticket 1.2, data-model §5 "Tool edit")', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
  });

  async function seedContribution(qomon: InMemoryQomon) {
    qomon.seedContact({ id: 1, firstname: 'Dana', surname: 'Donor' });
    const bundle = qomon.seedBundle({
      transactions: [{ contact_id: 1, amount: 5_000, date: '2026-03-01T00:00:00.000Z', status_id: 1 }],
    });
    const contact = await prisma.contact.create({
      data: { qomonContactId: 1n, name: 'Dana Donor' },
    });
    const contribution = await prisma.contribution.create({
      data: {
        qomonTransactionId: BigInt(bundle.transactions[0]!.id),
        qomonBundleId: BigInt(bundle.id),
        contactId: contact.id,
        amountCents: 5_000,
        acceptedAt: new Date('2026-03-01T00:00:00Z'),
      },
    });
    return { bundle, contribution };
  }

  it('writes Qomon first, then commits cache + change-log in one transaction, on success', async () => {
    const qomon = new InMemoryQomon();
    const { contribution } = await seedContribution(qomon);
    const d = descriptive();

    const result = await writeContributionMetadata(
      { prisma, qomon },
      { contributionId: contribution.id, actorUserId: baseline.adminUserId, reason: 'CFO entry review', descriptive: d },
    );

    expect(result).toMatchObject({ ridingNumber: 84, entityKind: 'CA', receivedBy: 'ENTITY' });
    expect(result.checksum).toBe(computeMetadataChecksum(d));

    const bundle = await qomon.getTransactionBundle(Number(contribution.qomonBundleId));
    expect(bundle.transactions[0]?.metadata?.gpo.riding_number).toBe(84);

    const entries = await prisma.changeLogEntry.findMany({ where: { subjectType: 'ContributionMetadata' } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorUserId: baseline.adminUserId, reason: 'CFO entry review' });
  });

  it('is a whole-object write: a second edit fully replaces the first, not merges', async () => {
    const qomon = new InMemoryQomon();
    const { contribution } = await seedContribution(qomon);
    await writeContributionMetadata(
      { prisma, qomon },
      { contributionId: contribution.id, actorUserId: baseline.adminUserId, reason: 'first', descriptive: descriptive({ non_deductible_cents: 100 }) },
    );
    await writeContributionMetadata(
      { prisma, qomon },
      { contributionId: contribution.id, actorUserId: baseline.adminUserId, reason: 'second', descriptive: descriptive({ non_deductible_cents: 0, source_code: 'x' }) },
    );
    const row = await prisma.contributionMetadata.findUnique({ where: { contributionId: contribution.id } });
    expect(row?.nonDeductibleCents).toBe(0);
    expect(row?.sourceCode).toBe('x');
  });

  it('rejects the edit visibly and touches nothing locally when the Qomon write fails', async () => {
    const qomon = new InMemoryQomon();
    const { contribution } = await seedContribution(qomon);
    qomon.failFor = 99;

    await expect(
      writeContributionMetadata(
        { prisma, qomon },
        { contributionId: contribution.id, actorUserId: baseline.adminUserId, reason: 'x', descriptive: descriptive() },
      ),
    ).rejects.toBeInstanceOf(QomonWriteRejectedError);

    expect(await prisma.contributionMetadata.findUnique({ where: { contributionId: contribution.id } })).toBeNull();
    expect(await prisma.changeLogEntry.count()).toBe(0);
  });

  it('refuses to cache an edit whose Qomon echo does not confirm the write', async () => {
    const qomon = new InMemoryQomon();
    const { contribution } = await seedContribution(qomon);
    // simulate a Qomon that silently drops part of the write: patch succeeds
    // but returns a bundle whose transaction has no metadata at all
    const originalPatch = qomon.patchTransactionBundle.bind(qomon);
    qomon.patchTransactionBundle = async (patch) => {
      const result = await originalPatch(patch);
      result.transactions = result.transactions.map((t) => ({ ...t, metadata: undefined }));
      return result;
    };

    await expect(
      writeContributionMetadata(
        { prisma, qomon },
        { contributionId: contribution.id, actorUserId: baseline.adminUserId, reason: 'x', descriptive: descriptive() },
      ),
    ).rejects.toBeInstanceOf(QomonWriteUnconfirmedError);
    expect(await prisma.contributionMetadata.findUnique({ where: { contributionId: contribution.id } })).toBeNull();
  });

  it('blocks a metadata edit once the contribution backs an issued receipt (invariant 6 / correction workflow)', async () => {
    const qomon = new InMemoryQomon();
    const { contribution } = await seedContribution(qomon);
    await issueReceipt(prisma, {
      contactId: contribution.contactId,
      contributionId: contribution.id,
      periodId: baseline.periodId,
      amountCents: 5_000,
      actorUserId: baseline.cfoUserId,
    });

    await expect(
      writeContributionMetadata(
        { prisma, qomon },
        { contributionId: contribution.id, actorUserId: baseline.adminUserId, reason: 'x', descriptive: descriptive() },
      ),
    ).rejects.toBeInstanceOf(MetadataWriteBlockedError);

    // the Qomon side was never touched either: the block happens before the PATCH
    const bundle = await qomon.getTransactionBundle(Number(contribution.qomonBundleId));
    expect(bundle.transactions[0]?.metadata).toBeUndefined();
  });

  it('throws ContributionNotFoundError for an unknown id', async () => {
    const qomon = new InMemoryQomon();
    await expect(
      writeContributionMetadata(
        { prisma, qomon },
        { contributionId: 'does-not-exist', actorUserId: baseline.adminUserId, reason: 'x', descriptive: descriptive() },
      ),
    ).rejects.toBeInstanceOf(ContributionNotFoundError);
  });
});
