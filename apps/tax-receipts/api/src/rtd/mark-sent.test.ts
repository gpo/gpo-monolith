import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import { isReceiptedOrReported } from '../contributions/metadata-cache.js';
import { makeContribution, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import {
  RtdFilingAlreadySentError,
  RtdFilingNotFoundError,
  RtdSendBlockedError,
  UnsupportedFilingKindError,
  markRtdFilingSent,
} from './mark-sent.js';
import { prepareRtdFiling } from './prepare.js';

const prisma = testPrisma();

describe('RTD filing mark-sent, DB-backed (redesigned from ticket 2.3\'s "stamp")', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let storageDir: string;
  let nextContactId: bigint;
  let nextTxId: bigint;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-rtd-mark-sent-test-'));
    nextContactId = 1n;
    nextTxId = 1n;
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  async function seedMetadata(contributionId: string) {
    return withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contribution.update({ where: { id: contributionId }, data: {
          periodId: baseline.periodId,
          entityKind: 'PARTY',
          ridingNumber: null,
          receivedBy: 'GPO',
          goodsServices: false,
        } });
      await ctx.log({ subjectType: 'Contribution', subjectId: contributionId, after });
      return after;
    });
  }

  async function seedPreparedFiling(amountCents = 25_000) {
    const made = await makeContribution(prisma, {
      qomonContactId: nextContactId++,
      qomonTransactionId: nextTxId++,
      amountCents,
      acceptedAt: new Date('2026-03-01T12:00:00Z'),
      contactFirstName: 'Dana',
      contactLastName: 'Donor',
    });
    await seedMetadata(made.contributionId);
    const prepared = await prepareRtdFiling(
      { prisma, storageDir },
      {
        year: 2026,
        contributionIds: [made.contributionId],
        actorUserId: baseline.cfoUserId,
        reason: 'prepared for mark-sent test',
        cfoName: 'Casey CFO',
        asOf: new Date('2026-03-06T15:00:00Z'),
      },
    );
    return { contribution: made, prepared };
  }

  it('marks a prepared filing sent, recording submittedAt/submittedBy', async () => {
    const { prepared } = await seedPreparedFiling();

    const result = await markRtdFilingSent(prisma, {
      rtdFilingId: prepared.rtdFilingId,
      actorUserId: baseline.cfoUserId,
      reason: 'emailed to EO 2026-03-07',
      asOf: new Date('2026-03-07T12:00:00Z'),
    });
    expect(result.submittedAt).toEqual(new Date('2026-03-07T12:00:00Z'));

    const filing = await prisma.rtdFiling.findUnique({ where: { id: prepared.rtdFilingId } });
    expect(filing?.submittedAt).toEqual(new Date('2026-03-07T12:00:00Z'));
    expect(filing?.submittedBy).toBe(baseline.cfoUserId);

    const entry = await prisma.changeLogEntry.findFirst({
      where: { subjectType: 'RtdFiling', subjectId: prepared.rtdFilingId, reason: 'emailed to EO 2026-03-07' },
    });
    expect(entry).not.toBeNull();
  });

  it('a prepared-but-unsent filing already blocks direct edits (isReceiptedOrReported), independent of send', async () => {
    const { contribution } = await seedPreparedFiling();
    expect(await isReceiptedOrReported(prisma, contribution.contributionId)).toBe(true);
  });

  it('throws for an unknown filing id', async () => {
    await expect(
      markRtdFilingSent(prisma, { rtdFilingId: 'not-a-real-id', actorUserId: baseline.cfoUserId, reason: 'x' }),
    ).rejects.toThrow(RtdFilingNotFoundError);
  });

  it('refuses a non-INITIAL filing (DC1A_AMENDMENT is filed in one step, dc1a.ts)', async () => {
    const amendment = await prisma.rtdFiling.create({ data: { name: '2026_RTD_8_DC1A_TEST', kind: 'DC1A_AMENDMENT' } });
    await expect(
      markRtdFilingSent(prisma, { rtdFilingId: amendment.id, actorUserId: baseline.cfoUserId, reason: 'x' }),
    ).rejects.toThrow(UnsupportedFilingKindError);
  });

  it('refuses to re-mark an already-sent filing', async () => {
    const { prepared } = await seedPreparedFiling();
    await markRtdFilingSent(prisma, {
      rtdFilingId: prepared.rtdFilingId,
      actorUserId: baseline.cfoUserId,
      reason: 'first send',
      asOf: new Date('2026-03-07T12:00:00Z'),
    });
    await expect(
      markRtdFilingSent(prisma, {
        rtdFilingId: prepared.rtdFilingId,
        actorUserId: baseline.cfoUserId,
        reason: 'second send',
      }),
    ).rejects.toThrow(RtdFilingAlreadySentError);
  });

  it('refuses to mark sent if a row has drifted into a blocked state since prepare', async () => {
    const { contribution, prepared } = await seedPreparedFiling();
    await prisma.workItem.create({
      data: {
        kind: 'VALIDATION',
        subjectType: 'Contribution',
        subjectId: contribution.contributionId,
        contactId: contribution.contactId,
        ruleRef: 'B1',
      },
    });

    await expect(
      markRtdFilingSent(prisma, {
        rtdFilingId: prepared.rtdFilingId,
        actorUserId: baseline.cfoUserId,
        reason: 'attempt despite drift',
      }),
    ).rejects.toThrow(RtdSendBlockedError);

    const filing = await prisma.rtdFiling.findUnique({ where: { id: prepared.rtdFilingId } });
    expect(filing?.submittedAt).toBeNull();
  });
});
