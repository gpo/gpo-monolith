import { beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import { makeContribution, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import {
  RtdExportBlockedError,
  RtdStampSelectionError,
  stampRtdFiling,
} from './stamp.js';

const prisma = testPrisma();

describe('RTD filing stamp, DB-backed (ticket 2.3)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let nextContactId: bigint;
  let nextTxId: bigint;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    nextContactId = 1n;
    nextTxId = 1n;
  });

  async function seedMetadata(contributionId: string) {
    return withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contributionMetadata.create({
        data: {
          contributionId,
          periodId: baseline.periodId,
          entityKind: 'PARTY',
          ridingNumber: null,
          receivedBy: 'GPO',
          goodsServices: false,
        },
      });
      await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contributionId, after });
      return after;
    });
  }

  /** An over-threshold, unreported party deposit — a draft candidate on its
   *  own (single-contribution aggregate above the $200 disclosure line). */
  async function seedDraftCandidate(amountCents = 25_000, acceptedAt = new Date('2026-03-01T12:00:00Z')) {
    const made = await makeContribution(prisma, {
      qomonContactId: nextContactId++,
      qomonTransactionId: nextTxId++,
      amountCents,
      acceptedAt,
      contactFirstName: 'Dana',
      contactLastName: 'Donor',
    });
    await seedMetadata(made.contributionId);
    return made;
  }

  it('stamps the selected rows into a new RtdFiling with matching RtdInclusion rows', async () => {
    const a = await seedDraftCandidate(25_000, new Date('2026-03-01T12:00:00Z'));
    const b = await seedDraftCandidate(30_000, new Date('2026-03-05T12:00:00Z'));

    const result = await stampRtdFiling(prisma, {
      year: 2026,
      contributionIds: [a.contributionId, b.contributionId],
      actorUserId: baseline.cfoUserId,
      reason: 'first RTD filing',
      asOf: new Date('2026-03-06T15:00:00Z'),
    });

    expect(result.stampedCount).toBe(2);
    expect(result.filingName).toBe('2026_RTD_8_030620261000');

    const filing = await prisma.rtdFiling.findUnique({
      where: { id: result.rtdFilingId },
      include: { inclusions: true },
    });
    expect(filing?.kind).toBe('INITIAL');
    expect(filing?.format).toBe('CSV');
    expect(filing?.inclusions).toHaveLength(2);
    expect(filing?.inclusions.map((i) => i.contributionId).sort()).toEqual(
      [a.contributionId, b.contributionId].sort(),
    );

    const entry = await prisma.changeLogEntry.findFirst({
      where: { subjectType: 'RtdFiling', subjectId: result.rtdFilingId },
    });
    expect(entry?.reason).toBe('first RTD filing');
  });

  it('stamps a PIPE-format filing when requested, defaulting to CSV otherwise', async () => {
    const a = await seedDraftCandidate();
    const result = await stampRtdFiling(prisma, {
      year: 2026,
      contributionIds: [a.contributionId],
      actorUserId: baseline.cfoUserId,
      reason: 'pipe format filing',
      format: 'PIPE',
    });
    const filing = await prisma.rtdFiling.findUnique({ where: { id: result.rtdFilingId } });
    expect(filing?.format).toBe('PIPE');
  });

  it('a now-reported contribution drops out of the next draft, so double-stamping it fails as an invalid selection', async () => {
    const a = await seedDraftCandidate();
    await stampRtdFiling(prisma, {
      year: 2026,
      contributionIds: [a.contributionId],
      actorUserId: baseline.cfoUserId,
      reason: 'first filing',
      asOf: new Date('2026-03-06T15:00:00Z'),
    });

    await expect(
      stampRtdFiling(prisma, {
        year: 2026,
        contributionIds: [a.contributionId],
        actorUserId: baseline.cfoUserId,
        reason: 'accidental re-stamp',
        asOf: new Date('2026-03-07T15:00:00Z'),
      }),
    ).rejects.toThrow(RtdStampSelectionError);

    expect(await prisma.rtdFiling.count()).toBe(1);
  });

  it('rejects a selection that includes an id outside the current draft', async () => {
    const a = await seedDraftCandidate();
    await expect(
      stampRtdFiling(prisma, {
        year: 2026,
        contributionIds: [a.contributionId, 'not-a-real-id'],
        actorUserId: baseline.cfoUserId,
        reason: 'bad selection',
      }),
    ).rejects.toThrow(RtdStampSelectionError);
    expect(await prisma.rtdFiling.count()).toBe(0);
  });

  it('rejects an empty selection', async () => {
    await expect(
      stampRtdFiling(prisma, {
        year: 2026,
        contributionIds: [],
        actorUserId: baseline.cfoUserId,
        reason: 'nothing selected',
      }),
    ).rejects.toThrow(RtdStampSelectionError);
  });

  it('blocks a selection with an open RTD-gate finding, stamping nothing', async () => {
    const clean = await seedDraftCandidate(25_000, new Date('2026-03-01T12:00:00Z'));
    const flagged = await seedDraftCandidate(25_000, new Date('2026-03-02T12:00:00Z'));
    await prisma.workItem.create({
      data: {
        kind: 'VALIDATION',
        subjectType: 'Contribution',
        subjectId: flagged.contributionId,
        contactId: flagged.contactId,
        ruleRef: 'B1',
      },
    });

    await expect(
      stampRtdFiling(prisma, {
        year: 2026,
        contributionIds: [clean.contributionId, flagged.contributionId],
        actorUserId: baseline.cfoUserId,
        reason: 'includes a blocked row',
      }),
    ).rejects.toThrow(RtdExportBlockedError);
    expect(await prisma.rtdFiling.count()).toBe(0);
  });

  it('lets the filer hold a blocked row back and stamp only the clean selection', async () => {
    const clean = await seedDraftCandidate(25_000, new Date('2026-03-01T12:00:00Z'));
    const flagged = await seedDraftCandidate(25_000, new Date('2026-03-02T12:00:00Z'));
    await prisma.workItem.create({
      data: {
        kind: 'VALIDATION',
        subjectType: 'Contribution',
        subjectId: flagged.contributionId,
        contactId: flagged.contactId,
        ruleRef: 'B1',
      },
    });

    const result = await stampRtdFiling(prisma, {
      year: 2026,
      contributionIds: [clean.contributionId],
      actorUserId: baseline.cfoUserId,
      reason: 'stamping the clean row only',
    });
    expect(result.stampedCount).toBe(1);

    const inclusion = await prisma.rtdInclusion.findFirst({ where: { contributionId: clean.contributionId } });
    expect(inclusion).not.toBeNull();
    const stillUnreported = await prisma.rtdInclusion.findFirst({ where: { contributionId: flagged.contributionId } });
    expect(stillUnreported).toBeNull();
  });
});
