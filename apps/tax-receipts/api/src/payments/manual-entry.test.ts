import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { addContributionToPayment, enterManualPayment, ManualEntryError, previewIntake } from './manual-entry.js';

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

    const metadata = await prisma.contribution.findUniqueOrThrow({ where: { id: contribution.id } });
    expect(metadata).toMatchObject({ periodId: baseline.periodId, entityKind: 'PARTY', receivedBy: 'GPO' });
  });

  it('logs the payment, contribution, and metadata in one cascade carrying the actor and reason', async () => {
    await enterManualPayment(prisma, base());
    const entries = await prisma.changeLogEntry.findMany();
    expect(entries.map((e) => e.subjectType).sort()).toEqual(['Contribution', 'Payment']);
    expect(new Set(entries.map((e) => e.correlationId)).size).toBe(1);
    expect(entries.every((e) => e.actorUserId === baseline.cfoUserId && e.reason === base().reason)).toBe(true);
  });

  it('lets the operator override the derived descriptive fields', async () => {
    const { contribution } = await enterManualPayment(prisma, {
      ...base(),
      descriptive: { entity_kind: 'CA', riding_number: 84, received_by: 'ENTITY', source_code: 'subspace:84' },
    });
    const metadata = await prisma.contribution.findUniqueOrThrow({ where: { id: contribution.id } });
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
    const metadata = await prisma.contribution.findUniqueOrThrow({ where: { id: contribution.id } });
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

  describe('a payment attributed across several contributions', () => {
    it('creates every contribution on the one payment, each with its own donor, entity, and derived period', async () => {
      const sam = await prisma.contact.create({ data: { name: 'Sam Spouse' } });
      await prisma.riding.create({ data: { ridingNumber: 12, name: 'Brampton West', active: true, qomonApiKey: 'x' } });

      const result = await enterManualPayment(prisma, {
        ...base(),
        contributions: [
          { amountCents: 4_000 },
          { amountCents: 2_500, contactId: sam.id },
          { amountCents: 1_000, descriptive: { entity_kind: 'CA', riding_number: 12 } },
        ],
      });

      expect(result.contributions).toHaveLength(3);
      const rows = await prisma.contribution.findMany({ where: { paymentId: result.payment.id }, orderBy: { createdAt: 'asc' } });
      expect(rows.map((r) => [r.contactId, r.amountCents, r.entityKind, r.ridingNumber, r.periodId])).toEqual([
        [contactId, 4_000, 'PARTY', null, baseline.periodId],
        [sam.id, 2_500, 'PARTY', null, baseline.periodId],
        [contactId, 1_000, 'CA', 12, baseline.periodId],
      ]);
      expect(rows.every((r) => r.correlationId === rows[0]!.correlationId)).toBe(true);
      expect(result.payment.contactId).toBe(contactId); // the payer stays the payer
    });

    it('accepts contributions that add up to less than the payment, leaving the rest unattributed', async () => {
      const result = await enterManualPayment(prisma, { ...base(), contributions: [{ amountCents: 5_000 }] });
      expect(result.contributions).toHaveLength(1);
    });

    it('refuses contributions that add up to more than the payment, writing nothing', async () => {
      await expect(
        enterManualPayment(prisma, { ...base(), contributions: [{ amountCents: 5_000 }, { amountCents: 2_501 }] }),
      ).rejects.toThrow(/add up to 7501c but the payment is 7500c/);
      expect(await prisma.payment.count()).toBe(0);
    });

    it('rolls everything back when a later contribution fails', async () => {
      await expect(
        enterManualPayment(prisma, {
          ...base(),
          contributions: [{ amountCents: 4_000 }, { amountCents: 3_000, descriptive: { entity_kind: 'CA' } }],
        }),
      ).rejects.toThrow(/needs a riding number/);
      expect(await prisma.payment.count()).toBe(0);
      expect(await prisma.contribution.count()).toBe(0);
    });

    it('refuses an empty list', async () => {
      await expect(enterManualPayment(prisma, { ...base(), contributions: [] })).rejects.toThrow(/at least one contribution/);
    });
  });

  it('refuses a party contribution with a riding, and a merged-away contact', async () => {
    await expect(
      enterManualPayment(prisma, { ...base(), descriptive: { entity_kind: 'PARTY', riding_number: 12 } }),
    ).rejects.toThrow(/party contribution carries no riding/);

    const survivor = await prisma.contact.create({ data: { name: 'Val T.' } });
    const merged = await prisma.contact.create({ data: { name: 'Valerie T.', mergedIntoId: survivor.id } });
    await expect(enterManualPayment(prisma, { ...base(), contactId: merged.id })).rejects.toThrow(/merged into another contact/);
    await expect(
      enterManualPayment(prisma, { ...base(), contributions: [{ amountCents: 7_500, contactId: merged.id }] }),
    ).rejects.toThrow(/merged into another contact/);
  });

  describe('attributing the rest of a payment later', () => {
    it('adds a contribution within what is unattributed, and reports what is left', async () => {
      const { payment } = await enterManualPayment(prisma, { ...base(), contributions: [{ amountCents: 5_000 }] });
      const sam = await prisma.contact.create({ data: { name: 'Sam Spouse' } });

      const added = await addContributionToPayment(prisma, {
        actorUserId: baseline.cfoUserId,
        reason: 'the other half was Sam\'s',
        paymentId: payment.id,
        contactId: sam.id,
        amountCents: 2_000,
      });

      expect(added.remainingCents).toBe(500);
      expect(added.contribution).toMatchObject({ paymentId: payment.id, contactId: sam.id, amountCents: 2_000, periodId: baseline.periodId });
    });

    it('refuses more than is unattributed, and an unknown payment', async () => {
      const { payment } = await enterManualPayment(prisma, { ...base(), contributions: [{ amountCents: 5_000 }] });
      await expect(
        addContributionToPayment(prisma, { actorUserId: baseline.cfoUserId, reason: 'too much', paymentId: payment.id, amountCents: 2_501 }),
      ).rejects.toThrow(/only 2500c of this payment is still unattributed/);
      await expect(
        addContributionToPayment(prisma, { actorUserId: baseline.cfoUserId, reason: 'nope', paymentId: 'nope', amountCents: 1 }),
      ).rejects.toBeInstanceOf(ManualEntryError);
    });

    it('does not count a superseded contribution as attributed', async () => {
      const { payment, contribution } = await enterManualPayment(prisma, base());
      const { applyCorrection } = await import('../corrections/contribution-correction.js');
      const { correctAmount } = await import('../corrections/actions.js');
      const storageDir = '/tmp/unused-no-receipts';
      await applyCorrection(
        { prisma, storageDir },
        await correctAmount(prisma, { actorUserId: baseline.cfoUserId, reason: 'keyed wrong', contributionId: contribution.id, amountCents: 5_000 }),
      );
      const added = await addContributionToPayment(prisma, {
        actorUserId: baseline.cfoUserId,
        reason: 'the rest',
        paymentId: payment.id,
        amountCents: 2_500,
      });
      expect(added.remainingCents).toBe(0);
    });
  });

  describe('intake preview', () => {
    it('shows the period and defaults the derivation would settle on, with its flags', async () => {
      const preview = await previewIntake(prisma, { acceptedAt: new Date('2026-04-10T15:00:00Z') });
      expect(preview.descriptive).toMatchObject({ period_id: baseline.periodId, entity_kind: 'PARTY', received_by: 'GPO' });
      expect(preview.flags.map((f) => f.field)).toContain('entity_kind');
    });

    it('returns no descriptive fields when no period covers the date', async () => {
      const preview = await previewIntake(prisma, { acceptedAt: new Date('2010-01-01T00:00:00Z') });
      expect(preview.descriptive).toBeNull();
      expect(preview.flags.map((f) => f.field)).toContain('period_id');
    });
  });
});
