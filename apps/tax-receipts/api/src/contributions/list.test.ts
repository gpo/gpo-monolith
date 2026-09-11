import { beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import { issueReceipt, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { listContributions } from './list.js';

const prisma = testPrisma();

describe('listContributions (ticket 1.3)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
  });

  async function seedRow(opts: {
    qomonTransactionId: bigint;
    contactName?: string;
    contactEmail?: string | null;
    amountCents?: number;
    acceptedAt?: Date;
    ridingNumber?: number | null;
    entityKind?: 'PARTY' | 'CA' | 'CAMPAIGN';
  }) {
    const contact = await prisma.contact.create({
      data: {
        qomonContactId: opts.qomonTransactionId,
        name: opts.contactName ?? 'Dana Donor',
        email: opts.contactEmail ?? null,
      },
    });
    const contribution = await prisma.contribution.create({
      data: {
        contactId: contact.id,
        qomonTransactionId: opts.qomonTransactionId,
        amountCents: opts.amountCents ?? 5_000,
        acceptedAt: opts.acceptedAt ?? new Date('2026-03-01T12:00:00Z'),
      },
    });
    await withChangeLog(prisma, { userId: null, reason: 'fixture' }, async (ctx) => {
      const after = await ctx.tx.contributionMetadata.create({
        data: {
          contributionId: contribution.id,
          periodId: baseline.periodId,
          ridingNumber: opts.ridingNumber ?? null,
          entityKind: opts.entityKind ?? 'PARTY',
          receivedBy: 'GPO',
        },
      });
      await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contribution.id, after });
    });
    return { contact, contribution };
  }

  it('returns rows newest-first with metadata and contact joined', async () => {
    await seedRow({ qomonTransactionId: 1n, acceptedAt: new Date('2026-01-01T00:00:00Z') });
    await seedRow({ qomonTransactionId: 2n, acceptedAt: new Date('2026-06-01T00:00:00Z'), contactName: 'Pat Payer' });

    const page = await listContributions(prisma, { filters: {}, ridingScope: null });
    expect(page.data).toHaveLength(2);
    expect(page.data[0]?.contactName).toBe('Pat Payer'); // newest first
    expect(page.data[0]?.periodId).toBe(baseline.periodId);
  });

  it('filters by riding number and entity kind', async () => {
    await seedRow({ qomonTransactionId: 3n, ridingNumber: 84, entityKind: 'CA' });
    await seedRow({ qomonTransactionId: 4n, ridingNumber: 12, entityKind: 'CA' });

    const page = await listContributions(prisma, {
      filters: { ridingNumber: 84 },
      ridingScope: null,
    });
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.ridingNumber).toBe(84);
  });

  it('filters party-level only via ridingNumber: null', async () => {
    await seedRow({ qomonTransactionId: 5n, ridingNumber: null, entityKind: 'PARTY' });
    await seedRow({ qomonTransactionId: 6n, ridingNumber: 84, entityKind: 'CA' });

    const page = await listContributions(prisma, {
      filters: { ridingNumber: null },
      ridingScope: null,
    });
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.ridingNumber).toBeNull();
  });

  it('filters by donor name/email substring, case-insensitive', async () => {
    await seedRow({ qomonTransactionId: 7n, contactName: 'Dana Donor', contactEmail: 'dana@example.org' });
    await seedRow({ qomonTransactionId: 8n, contactName: 'Pat Payer', contactEmail: 'pat@example.org' });

    expect((await listContributions(prisma, { filters: { contactQuery: 'dana' }, ridingScope: null })).data).toHaveLength(1);
    expect((await listContributions(prisma, { filters: { contactQuery: 'EXAMPLE.ORG' }, ridingScope: null })).data).toHaveLength(2);
  });

  it('filters by amount and date range', async () => {
    await seedRow({ qomonTransactionId: 9n, amountCents: 1_000, acceptedAt: new Date('2026-01-01T00:00:00Z') });
    await seedRow({ qomonTransactionId: 10n, amountCents: 9_000, acceptedAt: new Date('2026-08-01T00:00:00Z') });

    expect((await listContributions(prisma, { filters: { minAmountCents: 5_000 }, ridingScope: null })).data).toHaveLength(1);
    expect(
      (await listContributions(prisma, { filters: { acceptedFrom: new Date('2026-06-01T00:00:00Z') }, ridingScope: null })).data,
    ).toHaveLength(1);
  });

  it('filters by receipt state', async () => {
    const { contact, contribution } = await seedRow({ qomonTransactionId: 11n, amountCents: 5_000 });
    await seedRow({ qomonTransactionId: 12n, amountCents: 5_000 });
    await issueReceipt(prisma, {
      contactId: contact.id,
      contributionId: contribution.id,
      periodId: baseline.periodId,
      amountCents: 5_000,
      actorUserId: baseline.cfoUserId,
    });

    const withReceipt = await listContributions(prisma, { filters: { hasReceipt: true }, ridingScope: null });
    expect(withReceipt.data).toHaveLength(1);
    expect(withReceipt.data[0]?.hasReceipt).toBe(true);

    const withoutReceipt = await listContributions(prisma, { filters: { hasReceipt: false }, ridingScope: null });
    expect(withoutReceipt.data).toHaveLength(1);
  });

  it('filters by open validation status and a specific ruleRef', async () => {
    const { contribution: c1 } = await seedRow({ qomonTransactionId: 13n });
    await seedRow({ qomonTransactionId: 14n });
    await prisma.workItem.create({
      data: { kind: 'VALIDATION', subjectType: 'Contribution', subjectId: c1.id, ruleRef: 'A8' },
    });

    const flagged = await listContributions(prisma, { filters: { hasOpenValidation: true }, ridingScope: null });
    expect(flagged.data).toHaveLength(1);
    expect(flagged.data[0]?.openValidationCount).toBe(1);

    const byRule = await listContributions(prisma, { filters: { ruleRef: 'A8' }, ridingScope: null });
    expect(byRule.data).toHaveLength(1);

    const clean = await listContributions(prisma, { filters: { hasOpenValidation: false }, ridingScope: null });
    expect(clean.data).toHaveLength(1);
    expect(clean.data[0]?.id).not.toBe(c1.id);
  });

  it('applies riding scope: party-level rows always visible, out-of-grant ridings hidden', async () => {
    await seedRow({ qomonTransactionId: 15n, ridingNumber: null, entityKind: 'PARTY' });
    await seedRow({ qomonTransactionId: 16n, ridingNumber: 84, entityKind: 'CA' });
    await seedRow({ qomonTransactionId: 17n, ridingNumber: 12, entityKind: 'CA' });

    const scoped = await listContributions(prisma, { filters: {}, ridingScope: [84] });
    expect(new Set(scoped.data.map((r) => r.ridingNumber))).toEqual(new Set([null, 84]));
  });

  it('paginates with a cursor', async () => {
    for (let i = 0; i < 5; i += 1) {
      await seedRow({ qomonTransactionId: BigInt(100 + i), acceptedAt: new Date(2026, 0, i + 1) });
    }
    const first = await listContributions(prisma, { filters: {}, limit: 2, ridingScope: null });
    expect(first.data).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await listContributions(prisma, {
      filters: {},
      limit: 2,
      cursor: first.nextCursor,
      ridingScope: null,
    });
    expect(second.data).toHaveLength(2);
    expect(second.data.map((r) => r.id)).not.toEqual(first.data.map((r) => r.id));
  });

  it('excludes contributions deleted in Qomon', async () => {
    const { contribution } = await seedRow({ qomonTransactionId: 200n });
    await prisma.contribution.update({ where: { id: contribution.id }, data: { deletedInQomonAt: new Date() } });
    const page = await listContributions(prisma, { filters: {}, ridingScope: null });
    expect(page.data).toHaveLength(0);
  });
});
