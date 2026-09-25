import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setKillSwitch } from '../auth/kill-switch.js';
import { withChangeLog } from '../changelog/write.js';
import type { Prisma } from '../generated/prisma/index.js';
import { issueReceipt } from '../receipts/issue.js';
import { markRtdFilingSent } from '../rtd/mark-sent.js';
import { prepareRtdFiling } from '../rtd/prepare.js';
import { createTestContribution, fixtureWrite, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { correctAmount, moveContributions, moveReceipt, reallocate, refund, splitContribution } from './actions.js';
import {
  CorrectionBlockedError,
  CorrectionValidationError,
  PaymentSumExceededError,
  applyCorrection,
  previewCorrection,
} from './contribution-correction.js';

const prisma = testPrisma();

const GOOD_ADDRESS = [
  { housenumber: '1', street: 'Main St', city: 'Toronto', state: 'ON', postalcode: 'M1M1M1', country: 'CA' },
];

describe('contribution correction engine (corrections.md actions 4, 5, 6, 8, 9, 12)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let storageDir: string;
  let nextTransactionId: number;
  let nextContactId: bigint;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-correction-engine-'));
    nextTransactionId = 1;
    nextContactId = 1n;
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  const deps = () => ({ prisma, storageDir });
  const common = () => ({
    actorUserId: baseline.cfoUserId,
    reason: 'correction test',
    politicalEntityLabel: 'Green Party of Ontario',
  });

  async function seedContact(name = 'Dana Donor', addresses: unknown[] = GOOD_ADDRESS) {
    return prisma.contact.create({
      data: { qomonContactId: nextContactId++, name, addresses: addresses as Prisma.InputJsonValue },
    });
  }

  /** a contribution with intake metadata, optionally receipted */
  async function seedContribution(
    contactId: string,
    opts: { amountCents?: number; receipted?: boolean; nonDeductibleCents?: number; eoContributorId?: string } = {},
  ) {
    const contribution = await createTestContribution(prisma, {
      qomonTransactionId: BigInt(nextTransactionId++),
      contactId,
      amountCents: opts.amountCents ?? 10_000,
      acceptedAt: new Date('2026-03-01T12:00:00Z'),
    });
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contribution.update({
        where: { id: contribution.id },
        data: {
          periodId: baseline.periodId,
          entityKind: 'PARTY',
          receivedBy: 'GPO',
          nonDeductibleCents: opts.nonDeductibleCents ?? 0,
          eoContributorId: opts.eoContributorId ?? null,
        },
      });
      await ctx.log({ subjectType: 'Contribution', subjectId: contribution.id, after });
    });
    let receiptId: string | null = null;
    if (opts.receipted) {
      const issued = await issueReceipt(deps(), {
        contributionId: contribution.id,
        actorUserId: baseline.cfoUserId,
        reason: 'issue for test',
        politicalEntityLabel: 'Green Party of Ontario',
      });
      receiptId = issued.id;
    }
    return { contribution, receiptId };
  }

  async function reportViaRtd(contributionId: string) {
    const prepared = await prepareRtdFiling(deps(), {
      year: 2026,
      contributionIds: [contributionId],
      actorUserId: baseline.cfoUserId,
      reason: 'initial filing',
      cfoName: 'Casey CFO',
    });
    await markRtdFilingSent(prisma, {
      rtdFilingId: prepared.rtdFilingId,
      actorUserId: baseline.cfoUserId,
      reason: 'emailed to EO',
    });
  }

  describe('action 4: correct amount', () => {
    it('supersedes an unreceipted contribution with a corrected row and touches no receipts', async () => {
      const dana = await seedContact();
      const { contribution } = await seedContribution(dana.id, { amountCents: 10_000 });
      // the payment was mis-keyed too: it was really $80
      const input = await correctAmount(prisma, {
        ...common(),
        contributionId: contribution.id,
        amountCents: 8_000,
        paymentAmountCents: 8_000,
      });

      const result = await applyCorrection(deps(), input);

      expect(result.supersededContributionIds).toEqual([contribution.id]);
      expect(result.cancelledReceiptIds).toEqual([]);
      expect(result.issuedReceipts).toEqual([]);
      const old = await prisma.contribution.findUniqueOrThrow({ where: { id: contribution.id } });
      expect(old.status).toBe('SUPERSEDED');
      const replacement = await prisma.contribution.findUniqueOrThrow({ where: { id: result.createdContributionIds[0]! } });
      expect(replacement).toMatchObject({
        status: 'ACTIVE',
        amountCents: 8_000,
        supersedesId: contribution.id,
        paymentId: contribution.paymentId,
        periodId: baseline.periodId,
        correlationId: result.correlationId,
      });
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: contribution.paymentId } });
      expect(payment.amountCents).toBe(8_000);
    });

    it('refuses an amount above the payment unless the payment is corrected in the same action', async () => {
      const dana = await seedContact();
      const { contribution } = await seedContribution(dana.id, { amountCents: 10_000 });

      const tooBig = await correctAmount(prisma, { ...common(), contributionId: contribution.id, amountCents: 12_000 });
      await expect(applyCorrection(deps(), tooBig)).rejects.toBeInstanceOf(PaymentSumExceededError);

      const withPayment = await correctAmount(prisma, {
        ...common(),
        contributionId: contribution.id,
        amountCents: 12_000,
        paymentAmountCents: 12_000,
      });
      const result = await applyCorrection(deps(), withPayment);
      expect(result.createdContributionIds).toHaveLength(1);
    });

    it('cancels and reissues a receipted contribution: the old number is retained and the new receipt says it replaces it', async () => {
      const dana = await seedContact();
      const { contribution, receiptId } = await seedContribution(dana.id, { amountCents: 10_000, receipted: true });

      const input = await correctAmount(prisma, {
        ...common(),
        contributionId: contribution.id,
        amountCents: 7_500,
        paymentAmountCents: 7_500,
      });
      const plan = await previewCorrection(prisma, input);
      expect(plan.cancelReceipts.map((c) => c.receiptId)).toEqual([receiptId]);
      expect(plan.issueReceipts).toHaveLength(1);
      expect(plan.issueReceipts[0]).toMatchObject({ totalAmountCents: 7_500, replacesReceiptId: receiptId, primaryReplacement: true });
      expect(plan.blockers).toEqual([]);

      const result = await applyCorrection(deps(), input);

      const oldReceipt = await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId! } });
      expect(oldReceipt.status).toBe('CANCELLED');
      expect(result.issuedReceipts).toHaveLength(1);
      const issued = result.issuedReceipts[0]!;
      expect(oldReceipt.replacedById).toBe(issued.id);
      const fresh = await prisma.receipt.findUniqueOrThrow({
        where: { id: issued.id },
        include: { allocations: true, pdfArtifact: true },
      });
      expect(fresh.reissuedFromId).toBe(receiptId);
      expect(fresh.pdfArtifact).not.toBeNull();
      expect(fresh.allocations).toHaveLength(1);
      expect(fresh.allocations[0]).toMatchObject({ amountCents: 7_500, contributionId: result.createdContributionIds[0] });
      // the cancelled receipt's allocation stays as the audit record
      const kept = await prisma.receiptAllocation.count({ where: { receiptId: receiptId!, contributionId: contribution.id } });
      expect(kept).toBe(1);
      expect(result.cancellationNoticeArtifactIds).toHaveLength(1);
    });

    it('requires the non-deductible amount to be restated when the amount changes', async () => {
      const dana = await seedContact();
      const { contribution } = await seedContribution(dana.id, { amountCents: 10_000, nonDeductibleCents: 2_000 });
      const input = await correctAmount(prisma, { ...common(), contributionId: contribution.id, amountCents: 9_000 });
      await expect(applyCorrection(deps(), input)).rejects.toBeInstanceOf(CorrectionValidationError);

      const stated = await correctAmount(prisma, {
        ...common(),
        contributionId: contribution.id,
        amountCents: 9_000,
        nonDeductibleCents: 1_500,
      });
      const result = await applyCorrection(deps(), stated);
      const replacement = await prisma.contribution.findUniqueOrThrow({ where: { id: result.createdContributionIds[0]! } });
      expect(replacement.nonDeductibleCents).toBe(1_500);
    });
  });

  describe('preview', () => {
    it('writes nothing', async () => {
      const dana = await seedContact();
      const { contribution } = await seedContribution(dana.id, { receipted: true });
      const before = {
        contributions: await prisma.contribution.count(),
        receipts: await prisma.receipt.count(),
        logs: await prisma.changeLogEntry.count(),
      };

      const input = await correctAmount(prisma, {
        ...common(),
        contributionId: contribution.id,
        amountCents: 5_000,
        paymentAmountCents: 5_000,
      });
      await previewCorrection(prisma, input);

      expect({
        contributions: await prisma.contribution.count(),
        receipts: await prisma.receipt.count(),
        logs: await prisma.changeLogEntry.count(),
      }).toEqual(before);
    });

    it('lists "Qomon still shows" as a non-blocking follow-up', async () => {
      const dana = await seedContact();
      const { contribution } = await seedContribution(dana.id, { amountCents: 10_000 });
      const input = await correctAmount(prisma, {
        ...common(),
        contributionId: contribution.id,
        amountCents: 9_000,
        paymentAmountCents: 9_000,
      });
      const plan = await previewCorrection(prisma, input);
      expect(plan.followUps).toHaveLength(1);
      expect(plan.followUps[0]).toContain('Qomon still shows');
      expect(plan.blockers).toEqual([]);
    });
  });

  describe('EO awareness', () => {
    it('queues exactly one DC-1A item for an RTD-reported contribution, even when its receipt is cancelled too', async () => {
      const dana = await seedContact();
      const { contribution } = await seedContribution(dana.id, { amountCents: 25_000, receipted: true });
      await reportViaRtd(contribution.id);

      const input = await correctAmount(prisma, {
        ...common(),
        contributionId: contribution.id,
        amountCents: 20_000,
        paymentAmountCents: 20_000,
      });
      const plan = await previewCorrection(prisma, input);
      expect(plan.owedToEo.filter((o) => o.kind === 'DC1A')).toHaveLength(1);

      const result = await applyCorrection(deps(), input);
      const items = await prisma.workItem.findMany({ where: { kind: 'OWED_TO_EO' } });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ subjectType: 'Contribution', subjectId: contribution.id, status: 'OPEN', ruleRef: 'corrections-11' });
      expect(result.owedToEoWorkItemIds).toEqual([items[0]!.id]);
    });

    it('queues a return note for a receipt inside a filed report, and lists the report as dirty', async () => {
      const dana = await seedContact();
      const { contribution, receiptId } = await seedContribution(dana.id, { receipted: true });
      const report = await prisma.entityReport.create({
        data: {
          periodId: baseline.periodId,
          kind: 'ALL',
          entityKind: 'PARTY',
          filedAt: new Date(),
          receiptLinks: { create: { receiptId: receiptId! } },
        },
      });

      const input = await correctAmount(prisma, {
        ...common(),
        contributionId: contribution.id,
        amountCents: 6_000,
        paymentAmountCents: 6_000,
      });
      const plan = await previewCorrection(prisma, input);
      expect(plan.dirtyReports).toEqual([{ entityReportId: report.id, kind: 'ALL', periodId: baseline.periodId, filed: true }]);

      await applyCorrection(deps(), input);
      const notes = await prisma.workItem.findMany({ where: { kind: 'OWED_TO_EO', ruleRef: 'corrections-return-note' } });
      // one for the cancelled receipt, one for the replacement that falls in the same filed return
      expect(notes.map((n) => n.subjectType)).toEqual(['Receipt', 'Receipt']);
      expect(new Set(notes.map((n) => n.subjectId)).size).toBe(2);
    });

    it('closes open validation findings on a retired row', async () => {
      const dana = await seedContact();
      const { contribution } = await seedContribution(dana.id);
      const item = await withChangeLog(prisma, { userId: null, reason: 'seed finding' }, async (ctx) => {
        const row = await ctx.tx.workItem.create({
          data: { kind: 'VALIDATION', subjectType: 'Contribution', subjectId: contribution.id, ruleRef: 'A1' },
        });
        await ctx.log({ subjectType: 'WorkItem', subjectId: row.id, after: row });
        return row;
      });

      const input = await correctAmount(prisma, {
        ...common(),
        contributionId: contribution.id,
        amountCents: 9_000,
        paymentAmountCents: 9_000,
      });
      await applyCorrection(deps(), input);

      const closed = await prisma.workItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(closed.status).toBe('RESOLVED');
      expect(closed.closedAt).not.toBeNull();
    });
  });

  describe('blockers', () => {
    it('blocks a cascade that would issue a receipt while the kill switch is engaged', async () => {
      const dana = await seedContact();
      const { contribution } = await seedContribution(dana.id, { receipted: true });
      await setKillSwitch(prisma, { userId: baseline.cfoUserId, reason: 'EO request' }, true);

      const input = await correctAmount(prisma, {
        ...common(),
        contributionId: contribution.id,
        amountCents: 9_000,
        paymentAmountCents: 9_000,
      });
      const plan = await previewCorrection(prisma, input);
      expect(plan.blockers).toEqual(['receipt issuance is disabled by the kill switch']);
      await expect(applyCorrection(deps(), input)).rejects.toBeInstanceOf(CorrectionBlockedError);
      const old = await prisma.contribution.findUniqueOrThrow({ where: { id: contribution.id } });
      expect(old.status).toBe('ACTIVE');
    });

    it('does not block a refund on the kill switch: it only cancels', async () => {
      const dana = await seedContact();
      const { contribution } = await seedContribution(dana.id, { receipted: true });
      await setKillSwitch(prisma, { userId: baseline.cfoUserId, reason: 'EO request' }, true);

      const input = await refund(prisma, { ...common(), contributionIds: [contribution.id] });
      const result = await applyCorrection(deps(), input);
      expect(result.cancelledReceiptIds).toHaveLength(1);
    });

    it('blocks a move to a donor with no usable address, before writing anything', async () => {
      const dana = await seedContact();
      const noAddress = await seedContact('Nadia NoAddress', []);
      const { contribution } = await seedContribution(dana.id, { receipted: true });

      const input = await moveContributions(prisma, { ...common(), contributionIds: [contribution.id], toContactId: noAddress.id });
      const plan = await previewCorrection(prisma, input);
      expect(plan.blockers[0]).toContain('Nadia NoAddress is missing');
      await expect(applyCorrection(deps(), input)).rejects.toBeInstanceOf(CorrectionBlockedError);
      expect((await prisma.contribution.findUniqueOrThrow({ where: { id: contribution.id } })).status).toBe('ACTIVE');
    });

    it('requires a political entity label when receipts are issued', async () => {
      const dana = await seedContact();
      const { contribution } = await seedContribution(dana.id, { receipted: true });
      const input = await correctAmount(prisma, {
        actorUserId: baseline.cfoUserId,
        reason: 'no label',
        contributionId: contribution.id,
        amountCents: 9_000,
        paymentAmountCents: 9_000,
      });
      await expect(applyCorrection(deps(), input)).rejects.toBeInstanceOf(CorrectionValidationError);
    });
  });

  describe('action 5 and 6: move between donors', () => {
    it('cancels the old donor receipt with no replacement and issues a fresh, unlinked receipt to the new donor', async () => {
      const dana = await seedContact('Dana Donor');
      const robin = await seedContact('Robin Recipient');
      const { contribution, receiptId } = await seedContribution(dana.id, {
        amountCents: 10_000,
        receipted: true,
        eoContributorId: 'EO-111',
      });

      const input = await moveContributions(prisma, { ...common(), contributionIds: [contribution.id], toContactId: robin.id });
      const result = await applyCorrection(deps(), input);

      expect((await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId! } })).status).toBe('CANCELLED');
      expect(result.issuedReceipts).toHaveLength(1);
      expect(result.issuedReceipts[0]).toMatchObject({ contactId: robin.id, amountCents: 10_000, replacesReceiptId: null });
      const fresh = await prisma.receipt.findUniqueOrThrow({ where: { id: result.issuedReceipts[0]!.id } });
      expect(fresh.reissuedFromId).toBeNull();
      expect(fresh.contactNameSnapshot).toBe('Robin Recipient');
      expect((await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId! } })).replacedById).toBeNull();

      const moved = await prisma.contribution.findUniqueOrThrow({ where: { id: result.createdContributionIds[0]! } });
      expect(moved.contactId).toBe(robin.id);
      // the payer of record does not change with the attribution
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: contribution.paymentId } });
      expect(payment.contactId).toBe(dana.id);
      // an EO contributor id belongs to the donor it was assigned to
      expect(moved.eoContributorId).toBeNull();
    });

    it('moves an unreceipted contribution without touching any receipt', async () => {
      const dana = await seedContact('Dana Donor');
      const robin = await seedContact('Robin Recipient');
      const { contribution } = await seedContribution(dana.id);
      const result = await applyCorrection(
        deps(),
        await moveContributions(prisma, { ...common(), contributionIds: [contribution.id], toContactId: robin.id }),
      );
      expect(result.cancelledReceiptIds).toEqual([]);
      expect(result.issuedReceipts).toEqual([]);
    });

    it('moves a whole receipt: every active contribution on it goes to the new donor', async () => {
      const dana = await seedContact('Dana Donor');
      const robin = await seedContact('Robin Recipient');
      const first = await seedContribution(dana.id, { amountCents: 4_000, receipted: true });
      const second = await seedContribution(dana.id, { amountCents: 3_000 });
      const { allocateToReceipt } = await import('../receipts/allocate.js');
      await allocateToReceipt(
        { prisma },
        { receiptId: first.receiptId!, contributionId: second.contribution.id, actorUserId: baseline.cfoUserId, reason: 'consolidate' },
      );

      const input = await moveReceipt(prisma, { ...common(), receiptId: first.receiptId!, toContactId: robin.id });
      const result = await applyCorrection(deps(), input);

      expect(result.supersededContributionIds.sort()).toEqual([first.contribution.id, second.contribution.id].sort());
      expect(result.issuedReceipts).toHaveLength(1);
      expect(result.issuedReceipts[0]).toMatchObject({ contactId: robin.id, amountCents: 7_000 });
    });

    it('rejects moving a contribution to the donor it already belongs to', async () => {
      const dana = await seedContact();
      const { contribution } = await seedContribution(dana.id);
      await expect(
        moveContributions(prisma, { ...common(), contributionIds: [contribution.id], toContactId: dana.id }),
      ).rejects.toBeInstanceOf(CorrectionValidationError);
    });
  });

  describe('action 12: split a contribution', () => {
    it("divides a couple's cheque: one spouse's receipt is reissued, the other's is new", async () => {
      const dana = await seedContact('Dana Donor');
      const sam = await seedContact('Sam Spouse');
      const { contribution, receiptId } = await seedContribution(dana.id, { amountCents: 10_000, receipted: true });

      const input = await splitContribution(prisma, {
        ...common(),
        contributionId: contribution.id,
        parts: [{ amountCents: 6_000 }, { amountCents: 4_000, contactId: sam.id }],
      });
      const plan = await previewCorrection(prisma, input);
      expect(plan.issueReceipts.map((r) => [r.contactName, r.totalAmountCents])).toEqual([
        ['Dana Donor', 6_000],
        ['Sam Spouse', 4_000],
      ]);

      const result = await applyCorrection(deps(), input);

      expect(result.createdContributionIds).toHaveLength(2);
      const replacements = await prisma.contribution.findMany({ where: { supersedesId: contribution.id }, orderBy: { amountCents: 'desc' } });
      expect(replacements.map((r) => [r.contactId, r.amountCents])).toEqual([
        [dana.id, 6_000],
        [sam.id, 4_000],
      ]);
      const danaReceipt = result.issuedReceipts.find((r) => r.contactId === dana.id)!;
      const samReceipt = result.issuedReceipts.find((r) => r.contactId === sam.id)!;
      expect(danaReceipt.replacesReceiptId).toBe(receiptId);
      expect(samReceipt.replacesReceiptId).toBeNull();
      expect((await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId! } })).replacedById).toBe(danaReceipt.id);
      // both parts share the one payment, which still balances
      const payment = await prisma.payment.findUniqueOrThrow({
        where: { id: contribution.paymentId },
        include: { contributions: { where: { status: 'ACTIVE' } } },
      });
      expect(payment.contributions.reduce((s, c) => s + c.amountCents, 0)).toBe(payment.amountCents);
    });

    it('demands the parts account for the whole contribution', async () => {
      const dana = await seedContact();
      const { contribution } = await seedContribution(dana.id, { amountCents: 10_000 });
      await expect(
        splitContribution(prisma, {
          ...common(),
          contributionId: contribution.id,
          parts: [{ amountCents: 6_000 }, { amountCents: 3_000 }],
        }),
      ).rejects.toBeInstanceOf(CorrectionValidationError);
      await expect(
        splitContribution(prisma, { ...common(), contributionId: contribution.id, parts: [{ amountCents: 10_000 }] }),
      ).rejects.toBeInstanceOf(CorrectionValidationError);
    });

    it('splits the non-deductible amount across the parts, and refuses parts that do not add up to it', async () => {
      const dana = await seedContact();
      const sam = await seedContact('Sam Spouse');
      const { contribution } = await seedContribution(dana.id, { amountCents: 10_000, nonDeductibleCents: 1_000 });

      const bad = await splitContribution(prisma, {
        ...common(),
        contributionId: contribution.id,
        parts: [
          { amountCents: 5_000, nonDeductibleCents: 1_000 },
          { amountCents: 5_000, contactId: sam.id, nonDeductibleCents: 500 },
        ],
      });
      await expect(applyCorrection(deps(), bad)).rejects.toBeInstanceOf(CorrectionValidationError);

      const good = await splitContribution(prisma, {
        ...common(),
        contributionId: contribution.id,
        parts: [
          { amountCents: 5_000, nonDeductibleCents: 600 },
          { amountCents: 5_000, contactId: sam.id, nonDeductibleCents: 400 },
        ],
      });
      const result = await applyCorrection(deps(), good);
      expect(result.createdContributionIds).toHaveLength(2);
    });
  });

  describe('action 9: reallocate', () => {
    it('moves a party contribution to a CA: the party receipt is cancelled and the CA gets its own', async () => {
      const dana = await seedContact();
      await prisma.riding.create({ data: { ridingNumber: 12, name: 'Brampton West', active: true, qomonApiKey: 'x' } });
      const { contribution, receiptId } = await seedContribution(dana.id, { amountCents: 10_000, receipted: true });

      const input = await reallocate(prisma, {
        ...common(),
        contributionId: contribution.id,
        parts: [{ amountCents: 10_000, entityKind: 'CA', ridingNumber: 12 }],
        entityLabels: { 'CA:12': 'Brampton West CA' },
      });
      const plan = await previewCorrection(prisma, input);
      expect(plan.labelsNeeded).toEqual([{ entityKind: 'CA', ridingNumber: 12, key: 'CA:12' }]);

      const result = await applyCorrection(deps(), { ...input, entityLabels: { 'CA:12': 'Brampton West CA' } });

      const replacement = await prisma.contribution.findUniqueOrThrow({ where: { id: result.createdContributionIds[0]! } });
      expect(replacement).toMatchObject({ entityKind: 'CA', ridingNumber: 12 });
      const fresh = await prisma.receipt.findUniqueOrThrow({ where: { id: result.issuedReceipts[0]!.id } });
      expect(fresh).toMatchObject({ entityKind: 'CA', ridingNumber: 12, reissuedFromId: receiptId });
    });

    it('requires a riding for a CA or campaign part', async () => {
      const dana = await seedContact();
      const { contribution } = await seedContribution(dana.id);
      await expect(
        reallocate(prisma, { ...common(), contributionId: contribution.id, parts: [{ amountCents: 10_000, entityKind: 'CA' }] }),
      ).rejects.toBeInstanceOf(CorrectionValidationError);
    });
  });

  describe('action 8: refund', () => {
    it('marks the contribution and its payment REFUNDED, cancels the receipt, and issues nothing', async () => {
      const dana = await seedContact();
      const { contribution, receiptId } = await seedContribution(dana.id, { receipted: true });

      const input = await refund(prisma, { ...common(), paymentId: contribution.paymentId });
      const result = await applyCorrection(deps(), input);

      expect(result.refundedContributionIds).toEqual([contribution.id]);
      expect(result.issuedReceipts).toEqual([]);
      expect((await prisma.contribution.findUniqueOrThrow({ where: { id: contribution.id } })).status).toBe('REFUNDED');
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: contribution.paymentId } })).state).toBe('REFUNDED');
      expect((await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId! } })).status).toBe('CANCELLED');
    });

    it('leaves the payment RECEIVED when part of it is still an active contribution', async () => {
      const dana = await seedContact();
      const sam = await seedContact('Sam Spouse');
      const { contribution } = await seedContribution(dana.id, { amountCents: 10_000 });
      const split = await applyCorrection(
        deps(),
        await splitContribution(prisma, {
          ...common(),
          contributionId: contribution.id,
          parts: [{ amountCents: 6_000 }, { amountCents: 4_000, contactId: sam.id }],
        }),
      );
      const samsPart = await prisma.contribution.findFirstOrThrow({
        where: { id: { in: split.createdContributionIds }, contactId: sam.id },
      });

      await applyCorrection(deps(), await refund(prisma, { ...common(), contributionIds: [samsPart.id] }));

      expect((await prisma.payment.findUniqueOrThrow({ where: { id: contribution.paymentId } })).state).toBe('RECEIVED');
    });

    it('will not correct a row that has already been superseded', async () => {
      const dana = await seedContact();
      const { contribution } = await seedContribution(dana.id);
      await applyCorrection(
        deps(),
        await correctAmount(prisma, { ...common(), contributionId: contribution.id, amountCents: 9_000, paymentAmountCents: 9_000 }),
      );
      await expect(
        applyCorrection(deps(), await refund(prisma, { ...common(), contributionIds: [contribution.id] })),
      ).rejects.toMatchObject({ name: 'ContributionNotActiveError' });
    });
  });

  describe('audit trail', () => {
    it('logs every step of one correction under one correlation id, with the reason', async () => {
      const dana = await seedContact();
      const { contribution } = await seedContribution(dana.id, { receipted: true });
      const input = await correctAmount(prisma, {
        ...common(),
        reason: 'keyed the cheque wrong',
        contributionId: contribution.id,
        amountCents: 6_000,
        paymentAmountCents: 6_000,
      });
      const result = await applyCorrection(deps(), input);

      const entries = await prisma.changeLogEntry.findMany({ where: { correlationId: result.correlationId } });
      const subjects = new Set(entries.map((e) => e.subjectType));
      for (const s of ['Payment', 'Contribution', 'Receipt', 'ReceiptAllocation', 'AddressSnapshot']) {
        expect(subjects.has(s as never)).toBe(true);
      }
      expect(entries.every((e) => e.reason === 'keyed the cheque wrong')).toBe(true);
    });
  });

  describe('database guards', () => {
    it('refuses to change the material fields of a receipted contribution in place', async () => {
      const dana = await seedContact();
      const { contribution } = await seedContribution(dana.id, { receipted: true });
      await expect(
        fixtureWrite(prisma, (tx) => tx.contribution.update({ where: { id: contribution.id }, data: { amountCents: 1 } })),
      ).rejects.toThrow(/backs a receipt or an RTD filing/);
      // a non-material field still edits in place
      await fixtureWrite(prisma, (tx) => tx.contribution.update({ where: { id: contribution.id }, data: { sourceCode: 'X' } }));
    });

    it('freezes a superseded row entirely', async () => {
      const dana = await seedContact();
      const { contribution } = await seedContribution(dana.id);
      await applyCorrection(
        deps(),
        await correctAmount(prisma, { ...common(), contributionId: contribution.id, amountCents: 9_000, paymentAmountCents: 9_000 }),
      );
      await expect(
        fixtureWrite(prisma, (tx) => tx.contribution.update({ where: { id: contribution.id }, data: { note: 'edit' } })),
      ).rejects.toThrow(/is SUPERSEDED and is history/);
    });

    it('refuses to mark a contribution SUPERSEDED when nothing replaces it', async () => {
      const dana = await seedContact();
      const { contribution } = await seedContribution(dana.id);
      await expect(
        fixtureWrite(prisma, (tx) =>
          tx.contribution.update({ where: { id: contribution.id }, data: { status: 'SUPERSEDED' } }),
        ),
      ).rejects.toThrow(/nothing replaces it/);
    });

    it('lets one receipt be replaced by several: a partial reallocation reissues both halves from the same receipt', async () => {
      const dana = await seedContact();
      await prisma.riding.create({ data: { ridingNumber: 12, name: 'Brampton West', active: true, qomonApiKey: 'x' } });
      const { contribution, receiptId } = await seedContribution(dana.id, { amountCents: 10_000, receipted: true });

      const result = await applyCorrection(deps(), {
        ...(await reallocate(prisma, {
          ...common(),
          contributionId: contribution.id,
          parts: [{ amountCents: 6_000 }, { amountCents: 4_000, entityKind: 'CA', ridingNumber: 12 }],
        })),
        entityLabels: { 'CA:12': 'Brampton West CA' },
      });

      expect(result.issuedReceipts).toHaveLength(2);
      const reissued = await prisma.receipt.findMany({ where: { reissuedFromId: receiptId! }, orderBy: { receiptNumber: 'asc' } });
      expect(reissued).toHaveLength(2);
      // replacedById names the receipt in the same space as the original
      const old = await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId! } });
      const party = reissued.find((r) => r.entityKind === 'PARTY')!;
      expect(old.replacedById).toBe(party.id);
    });
  });
});
