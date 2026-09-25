import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { enterManualPayment, ManualEntryError } from './manual-entry.js';

const prisma = testPrisma();

describe('manual entry (D12): a payment and contribution with no Qomon transaction', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let contactId: string;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    // no Qomon link: allowed in development and testing (D12, invariant 9)
    contactId = (await prisma.contact.create({ data: { name: 'Dana Donor', email: 'dana@example.org' } })).id;
  });

  const base = () => ({
    actorUserId: baseline.cfoUserId,
    reason: 'cheque received at the party office',
    contactId,
    amountCents: 7_500,
    receivedAt: new Date('2026-04-10T15:00:00Z'),
    method: 'CHEQUE' as const,
  });

  it('creates a MANUAL payment with no Qomon link, one ACTIVE contribution, and derived metadata', async () => {
    const { payment, contribution } = await enterManualPayment(prisma, {
      ...base(),
      payerName: 'Dana and Sam Donor',
      externalRef: 'cheque-1042',
      note: 'joint cheque',
    });

    expect(payment).toMatchObject({
      source: 'MANUAL',
      amountCents: 7_500,
      method: 'CHEQUE',
      state: 'RECEIVED',
      payerName: 'Dana and Sam Donor',
      externalRef: 'cheque-1042',
      createdByUserId: baseline.cfoUserId,
    });
    expect(await prisma.qomonTransactionLink.count()).toBe(0);

    expect(contribution).toMatchObject({
      paymentId: payment.id,
      contactId,
      amountCents: 7_500,
      status: 'ACTIVE',
      createdByUserId: baseline.cfoUserId,
    });
    expect(contribution.acceptedAt).toEqual(new Date('2026-04-10T15:00:00Z'));

    const metadata = await prisma.contributionMetadata.findUniqueOrThrow({ where: { contributionId: contribution.id } });
    expect(metadata).toMatchObject({ periodId: baseline.periodId, entityKind: 'PARTY', receivedBy: 'GPO' });
  });

  it('logs the payment, contribution, and metadata in one cascade carrying the actor and reason', async () => {
    await enterManualPayment(prisma, base());
    const entries = await prisma.changeLogEntry.findMany();
    expect(entries.map((e) => e.subjectType).sort()).toEqual(['Contribution', 'ContributionMetadata', 'Payment']);
    expect(new Set(entries.map((e) => e.correlationId)).size).toBe(1);
    expect(entries.every((e) => e.actorUserId === baseline.cfoUserId && e.reason === base().reason)).toBe(true);
  });

  it('lets the operator override the derived descriptive fields', async () => {
    const { contribution } = await enterManualPayment(prisma, {
      ...base(),
      descriptive: { entity_kind: 'CA', riding_number: 84, received_by: 'ENTITY', source_code: 'subspace:84' },
    });
    const metadata = await prisma.contributionMetadata.findUniqueOrThrow({ where: { contributionId: contribution.id } });
    expect(metadata).toMatchObject({ entityKind: 'CA', ridingNumber: 84, receivedBy: 'ENTITY', sourceCode: 'subspace:84' });
  });

  it('rejects an amount that is not a positive whole number of cents, writing nothing', async () => {
    for (const amountCents of [0, -5, 12.5]) {
      await expect(enterManualPayment(prisma, { ...base(), amountCents })).rejects.toBeInstanceOf(ManualEntryError);
    }
    expect(await prisma.payment.count()).toBe(0);
  });

  it('rejects an unknown contact', async () => {
    await expect(enterManualPayment(prisma, { ...base(), contactId: 'nope' })).rejects.toBeInstanceOf(ManualEntryError);
  });

  it('rejects a date no period covers unless the operator picks a period', async () => {
    const outOfRange = { ...base(), receivedAt: new Date('2019-01-01T12:00:00Z') };
    await expect(enterManualPayment(prisma, outOfRange)).rejects.toThrow(/no reporting period/);
    expect(await prisma.payment.count()).toBe(0);

    const { contribution } = await enterManualPayment(prisma, {
      ...outOfRange,
      descriptive: { period_id: baseline.periodId },
    });
    const metadata = await prisma.contributionMetadata.findUniqueOrThrow({ where: { contributionId: contribution.id } });
    expect(metadata.periodId).toBe(baseline.periodId);
  });

  it('rejects a non-deductible portion larger than the amount', async () => {
    await expect(
      enterManualPayment(prisma, { ...base(), descriptive: { non_deductible_cents: 9_000 } }),
    ).rejects.toThrow(/non-deductible/);
  });

  it('requires a reason (invariant 5), writing nothing', async () => {
    await expect(enterManualPayment(prisma, { ...base(), reason: '  ' })).rejects.toThrow(/reason/);
    expect(await prisma.payment.count()).toBe(0);
  });
});
