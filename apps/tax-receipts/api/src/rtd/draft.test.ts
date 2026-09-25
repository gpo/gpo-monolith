import { beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import type { EntityKind, PaymentState } from '../generated/prisma/index.js';
import { makeContribution, resetDb, seedBaseline, testPrisma, createTestContribution, markSuperseded } from '../test/db.js';
import { buildRtdDraft, getRtdGateFindings } from './draft.js';

const prisma = testPrisma();

describe('RTD draft builder, DB-backed (ticket 2.2)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let nextContactId: bigint;
  let nextTxId: bigint;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    nextContactId = 1n;
    nextTxId = 1n;
  });

  async function seedMetadata(
    contributionId: string,
    overrides: {
      entityKind?: EntityKind;
      goodsServices?: boolean;
      eoContributorId?: string | null;
      periodId?: number;
    } = {},
  ) {
    return withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contribution.update({ where: { id: contributionId }, data: {
          periodId: overrides.periodId ?? baseline.periodId,
          entityKind: overrides.entityKind ?? 'PARTY',
          ridingNumber: null,
          receivedBy: 'GPO',
          goodsServices: overrides.goodsServices ?? false,
          eoContributorId: overrides.eoContributorId ?? null,
        } });
      await ctx.log({ subjectType: 'Contribution', subjectId: contributionId, after });
      return after;
    });
  }

  async function seedPartyContribution(opts: {
    amountCents: number;
    acceptedAt?: Date;
    paymentState?: PaymentState;
    entityKind?: EntityKind;
    goodsServices?: boolean;
    /** the contribution was replaced by a correction (D12) */
    superseded?: boolean;
    /** the Qomon transaction later vanished (D12: changes nothing here) */
    deletedInQomonAt?: Date | null;
    /** attach to an existing contact instead of creating a new one — the
     *  only way to get two contributions under one contact, since
     *  `makeContribution` always creates a fresh `Contact` row. */
    contactId?: string;
  }) {
    let contactId = opts.contactId;
    if (!contactId) {
      const made = await makeContribution(prisma, {
        qomonContactId: nextContactId++,
        qomonTransactionId: nextTxId++,
        amountCents: opts.amountCents,
        acceptedAt: opts.acceptedAt ?? new Date('2026-03-01T12:00:00Z'),
        contactFirstName: 'Dana',
        contactLastName: 'Donor',
      });
      contactId = made.contactId;
      await seedMetadata(made.contributionId, { entityKind: opts.entityKind, goodsServices: opts.goodsServices });
      await maybeUpdateStatus(made.contributionId, opts);
      return { contactId, contributionId: made.contributionId };
    }

    const contribution = await createTestContribution(prisma, {
        qomonTransactionId: nextTxId++,
        contactId,
        amountCents: opts.amountCents,
        acceptedAt: opts.acceptedAt ?? new Date('2026-03-01T12:00:00Z'),
      });
    await seedMetadata(contribution.id, { entityKind: opts.entityKind, goodsServices: opts.goodsServices });
    await maybeUpdateStatus(contribution.id, opts);
    return { contactId, contributionId: contribution.id };
  }

  async function maybeUpdateStatus(
    contributionId: string,
    opts: { paymentState?: PaymentState; superseded?: boolean; deletedInQomonAt?: Date | null },
  ) {
    const contribution = await prisma.contribution.findUniqueOrThrow({ where: { id: contributionId } });
    if (opts.paymentState) {
      await prisma.payment.update({ where: { id: contribution.paymentId }, data: { state: opts.paymentState } });
    }
    if (opts.deletedInQomonAt !== undefined) {
      await prisma.qomonTransactionLink.update({
        where: { paymentId: contribution.paymentId },
        data: { deletedInQomonAt: opts.deletedInQomonAt },
      });
    }
    if (opts.superseded) {
      await markSuperseded(prisma, contributionId);
    }
  }

  it('includes an unreported over-threshold party deposit, with clock and metadata attached', async () => {
    const first = await seedPartyContribution({ amountCents: 10_000, acceptedAt: new Date('2026-03-01T12:00:00Z') });
    await seedPartyContribution({
      amountCents: 10_001,
      acceptedAt: new Date('2026-03-05T12:00:00Z'),
      contactId: first.contactId,
    });

    const draft = await buildRtdDraft(prisma, { year: 2026, asOf: new Date('2026-03-06T12:00:00Z') });
    expect(draft.rows).toHaveLength(1);
    const row = draft.rows[0]!;
    expect(row.aggregateAfterCents).toBe(20_001);
    expect(row.periodId).toBe(baseline.periodId);
    expect(row.contactFirstName).toBe('Dana');
    expect(row.contactLastName).toBe('Donor');
    expect(row.gateFindings).toEqual([]);
    expect(row.overdue).toBe(false);
    expect(row.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('excludes G&S contributions even when large', async () => {
    await seedPartyContribution({ amountCents: 50_000, goodsServices: true });
    const draft = await buildRtdDraft(prisma, { year: 2026 });
    expect(draft.rows).toHaveLength(0);
  });

  it('excludes non-party (CA/CAMPAIGN) contributions', async () => {
    await seedPartyContribution({ amountCents: 50_000, entityKind: 'CA' });
    const draft = await buildRtdDraft(prisma, { year: 2026 });
    expect(draft.rows).toHaveLength(0);
  });

  it('excludes contributions whose payment never landed (state other than RECEIVED)', async () => {
    await seedPartyContribution({ amountCents: 50_000, paymentState: 'UNPAID' });
    const draft = await buildRtdDraft(prisma, { year: 2026 });
    expect(draft.rows).toHaveLength(0);
  });

  it('excludes superseded contributions (history, not the working set)', async () => {
    await seedPartyContribution({ amountCents: 50_000, superseded: true });
    const draft = await buildRtdDraft(prisma, { year: 2026 });
    expect(draft.rows).toHaveLength(0);
  });

  it('still includes a contribution whose Qomon transaction later vanished (D12: Qomon deletion changes nothing)', async () => {
    await seedPartyContribution({ amountCents: 50_000, deletedInQomonAt: new Date('2026-03-02T00:00:00Z') });
    const draft = await buildRtdDraft(prisma, { year: 2026 });
    expect(draft.rows).toHaveLength(1);
  });

  it('scopes to the requested calendar year', async () => {
    await seedPartyContribution({ amountCents: 50_000, acceptedAt: new Date('2025-06-01T12:00:00Z') });
    const draft2026 = await buildRtdDraft(prisma, { year: 2026 });
    expect(draft2026.rows).toHaveLength(0);
    const draft2025 = await buildRtdDraft(prisma, { year: 2025 });
    expect(draft2025.rows).toHaveLength(1);
  });

  it('an already-reported deposit is excluded from rows but still feeds the aggregate', async () => {
    const first = await seedPartyContribution({ amountCents: 25_000, acceptedAt: new Date('2026-03-01T12:00:00Z') });
    const second = await seedPartyContribution({
      amountCents: 1_000,
      acceptedAt: new Date('2026-03-05T12:00:00Z'),
      contactId: first.contactId,
    });

    // Stamp `first` as already reported by hand (ticket 2.3 isn't built
    // yet, so this simulates its write path directly on the schema).
    const filing = await prisma.rtdFiling.create({ data: { name: '2026_RTD_8_030120261200' } });
    await prisma.rtdInclusion.create({
      data: {
        contributionId: first.contributionId,
        rtdFilingId: filing.id,
        amountCents: 25_000,
        aggregateAfterCents: 25_000,
      },
    });

    const draft = await buildRtdDraft(prisma, { year: 2026 });
    expect(draft.rows).toHaveLength(1);
    expect(draft.rows[0]!.contributionId).toBe(second.contributionId);
    expect(draft.rows[0]!.aggregateAfterCents).toBe(26_000);
  });

  it('surfaces open A1/C4/B1/B2 work items as gate findings, ignoring other rules and resolved items', async () => {
    const { contributionId, contactId } = await seedPartyContribution({ amountCents: 50_000 });
    await prisma.workItem.create({
      data: { kind: 'VALIDATION', subjectType: 'Contribution', subjectId: contributionId, contactId, ruleRef: 'B2' },
    });
    await prisma.workItem.create({
      data: {
        kind: 'VALIDATION',
        subjectType: 'Contribution',
        subjectId: contributionId,
        contactId,
        ruleRef: 'A6', // not an RTD-gate rule
      },
    });
    await prisma.workItem.create({
      data: {
        kind: 'VALIDATION',
        subjectType: 'Contribution',
        subjectId: contributionId,
        contactId,
        ruleRef: 'A1',
        status: 'RESOLVED',
      },
    });

    const draft = await buildRtdDraft(prisma, { year: 2026 });
    expect(draft.rows).toHaveLength(1);
    expect(draft.rows[0]!.gateFindings.map((f) => f.ruleRef)).toEqual(['B2']);
  });

  it('getRtdGateFindings returns an empty map for no contribution ids', async () => {
    const result = await getRtdGateFindings(prisma, []);
    expect(result.size).toBe(0);
  });
});
