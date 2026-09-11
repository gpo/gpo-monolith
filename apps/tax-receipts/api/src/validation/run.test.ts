import { beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import { resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { runValidationForAllContributions, runValidationForContribution } from './run.js';

const prisma = testPrisma();

describe('validation engine v1 (ticket 1.7)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
  });

  async function seedContact(qomonContactId: bigint, email: string | null = null) {
    return prisma.contact.create({
      data: { qomonContactId, name: 'Dana Donor', email },
    });
  }

  async function seedContribution(opts: {
    contactId: string;
    qomonTransactionId: bigint;
    amountCents?: number;
    acceptedAt?: Date;
    paymentMethodKind?: string | null;
    externalRef?: string | null;
    metadata?: {
      ridingNumber?: number | null;
      entityKind?: 'PARTY' | 'CA' | 'CAMPAIGN';
      nonDeductibleCents?: number;
      sourceCode?: string;
      goodsServices?: boolean;
    };
  }) {
    const contribution = await prisma.contribution.create({
      data: {
        contactId: opts.contactId,
        qomonTransactionId: opts.qomonTransactionId,
        amountCents: opts.amountCents ?? 5_000,
        acceptedAt: opts.acceptedAt ?? new Date('2026-03-01T12:00:00Z'),
        paymentMethodKind: opts.paymentMethodKind ?? 'card',
        externalRef: opts.externalRef ?? null,
      },
    });
    if (opts.metadata !== null) {
      await withChangeLog(prisma, { userId: null, reason: 'test fixture' }, async (ctx) => {
        const after = await ctx.tx.contributionMetadata.create({
          data: {
            contributionId: contribution.id,
            periodId: baseline.periodId,
            ridingNumber: opts.metadata?.ridingNumber ?? null,
            entityKind: opts.metadata?.entityKind ?? 'PARTY',
            receivedBy: 'GPO',
            goodsServices: opts.metadata?.goodsServices ?? false,
            nonDeductibleCents: opts.metadata?.nonDeductibleCents ?? 0,
            sourceCode: opts.metadata?.sourceCode ?? '',
          },
        });
        await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contribution.id, after });
      });
    }
    return contribution;
  }

  it('returns null when the contribution has no metadata yet', async () => {
    const contact = await seedContact(1n);
    const contribution = await prisma.contribution.create({
      data: { contactId: contact.id, qomonTransactionId: 1n, amountCents: 1_000, acceptedAt: new Date('2026-03-01T00:00:00Z') },
    });
    expect(await runValidationForContribution(prisma, contribution.id)).toBeNull();
  });

  it('opens one WorkItem per failing rule', async () => {
    const contact = await seedContact(2n);
    const contribution = await seedContribution({
      contactId: contact.id,
      qomonTransactionId: 2n,
      amountCents: 10_000,
      paymentMethodKind: 'cash', // A8: cash over $25
      metadata: { entityKind: 'PARTY', ridingNumber: 84 }, // A2: PARTY with a riding
    });

    const result = await runValidationForContribution(prisma, contribution.id);
    expect(result?.opened).toBe(2);
    const items = await prisma.workItem.findMany({ where: { subjectId: contribution.id } });
    expect(items.map((i) => i.ruleRef).sort()).toEqual(['A2', 'A8']);
    expect(items.every((i) => i.status === 'OPEN')).toBe(true);
  });

  it('auto-resolves a WorkItem once the underlying data is fixed, and reopens it if it regresses', async () => {
    const contact = await seedContact(3n);
    const contribution = await seedContribution({
      contactId: contact.id,
      qomonTransactionId: 3n,
      metadata: { entityKind: 'PARTY', ridingNumber: 84 },
    });
    await runValidationForContribution(prisma, contribution.id);
    const opened = await prisma.workItem.findFirstOrThrow({ where: { subjectId: contribution.id, ruleRef: 'A2' } });

    await withChangeLog(prisma, { userId: null, reason: 'test fixture' }, async (ctx) => {
      const after = await ctx.tx.contributionMetadata.update({
        where: { contributionId: contribution.id },
        data: { ridingNumber: null },
      });
      await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contribution.id, after });
    });
    const second = await runValidationForContribution(prisma, contribution.id);
    expect(second?.resolved).toBe(1);
    const resolved = await prisma.workItem.findUniqueOrThrow({ where: { id: opened.id } });
    expect(resolved.status).toBe('RESOLVED');

    await withChangeLog(prisma, { userId: null, reason: 'test fixture' }, async (ctx) => {
      const after = await ctx.tx.contributionMetadata.update({
        where: { contributionId: contribution.id },
        data: { ridingNumber: 84 },
      });
      await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contribution.id, after });
    });
    const third = await runValidationForContribution(prisma, contribution.id);
    expect(third?.reopened).toBe(1);
    const reopened = await prisma.workItem.findUniqueOrThrow({ where: { id: opened.id } });
    expect(reopened.status).toBe('OPEN');
    expect(reopened.id).toBe(opened.id); // same row, not a duplicate
  });

  it('does not reopen an EXCEPTION granted this year, but does reopen one from a prior year', async () => {
    const contact = await seedContact(4n);
    const contribution = await seedContribution({
      contactId: contact.id,
      qomonTransactionId: 4n,
      metadata: { entityKind: 'PARTY', ridingNumber: 84 },
    });
    await runValidationForContribution(prisma, contribution.id);
    const item = await prisma.workItem.findFirstOrThrow({ where: { subjectId: contribution.id, ruleRef: 'A2' } });

    await prisma.workItem.update({
      where: { id: item.id },
      data: { status: 'EXCEPTION', resolutionNote: 'known case', closedAt: new Date() },
    });
    const thisYear = await runValidationForContribution(prisma, contribution.id);
    expect(thisYear?.reopened).toBe(0);
    expect((await prisma.workItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe('EXCEPTION');

    await prisma.workItem.update({
      where: { id: item.id },
      data: { closedAt: new Date('2025-06-01T00:00:00Z') },
    });
    const priorYear = await runValidationForContribution(prisma, contribution.id);
    expect(priorYear?.reopened).toBe(1);
    expect((await prisma.workItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe('OPEN');
  });

  it('flags A6 for a same-donor duplicate and B4 for a shared email across contacts', async () => {
    const email = 'dana@example.org';
    const contactA = await seedContact(5n, email);
    const contactB = await seedContact(6n, email);
    await seedContribution({ contactId: contactA.id, qomonTransactionId: 5n, amountCents: 7_500, acceptedAt: new Date('2026-03-01T00:00:00Z') });
    const dupe = await seedContribution({ contactId: contactA.id, qomonTransactionId: 50n, amountCents: 7_500, acceptedAt: new Date('2026-03-02T00:00:00Z') });

    const result = await runValidationForContribution(prisma, dupe.id);
    const refs = result?.findings.map((f) => f.ruleRef) ?? [];
    expect(refs).toContain('A6');
    expect(refs).toContain('B4');
    void contactB;
  });

  it('flags B2 once the donor crosses the configured limit', async () => {
    await prisma.contributionLimit.upsert({
      where: { year_bucket: { year: 2026, bucket: 'PARTY' } },
      create: { year: 2026, bucket: 'PARTY', amountCents: 500_000 },
      update: { amountCents: 500_000 },
    });
    const contact = await seedContact(7n);
    await seedContribution({ contactId: contact.id, qomonTransactionId: 7n, amountCents: 400_000, acceptedAt: new Date('2026-01-05T00:00:00Z') });
    const pushesOverLimit = await seedContribution({
      contactId: contact.id,
      qomonTransactionId: 70n,
      amountCents: 200_000,
      acceptedAt: new Date('2026-06-01T00:00:00Z'),
    });

    const result = await runValidationForContribution(prisma, pushesOverLimit.id);
    expect(result?.findings.map((f) => f.ruleRef)).toContain('B2');
  });

  it('runValidationForAllContributions sweeps every mirrored contribution with metadata', async () => {
    const contact = await seedContact(8n);
    await seedContribution({ contactId: contact.id, qomonTransactionId: 8n, paymentMethodKind: 'cash', amountCents: 10_000 });
    await prisma.contribution.create({
      data: { contactId: contact.id, qomonTransactionId: 80n, amountCents: 1, acceptedAt: new Date('2026-03-01T00:00:00Z') },
    }); // no metadata: skipped

    const result = await runValidationForAllContributions(prisma);
    expect(result.contributionsChecked).toBe(1);
    expect(result.opened).toBe(1);
  });
});
