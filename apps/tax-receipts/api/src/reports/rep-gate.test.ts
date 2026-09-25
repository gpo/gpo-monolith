import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import type { EntityKind } from '../generated/prisma/index.js';
import { makeContribution, issueReceipt as fixtureIssueReceipt, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { generateAllReport } from './all-report.js';
import { ReportExportBlockedError } from './load-receipts.js';
import { generateS2p2Report } from './s2p2-report.js';

const prisma = testPrisma();

/**
 * The REP4/REP6 export gate (ticket 4.3) lives inside `loadReportReceipts`
 * and so applies identically to both generators — these tests exercise it
 * through the API surface a real caller uses (`generateAllReport`/
 * `generateS2p2Report`), on top of the pure-function coverage in
 * `@gpo/tax-receipts-core`'s `rep-gate.test.ts`.
 */
describe('report-export gate (ticket 4.3)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let storageDir: string;
  let nextContactId: bigint;
  let nextTxId: bigint;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-rep-gate-test-'));
    nextContactId = 1n;
    nextTxId = 1n;
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  async function seedReceiptInto(opts: {
    entityKind: EntityKind;
    ridingNumber?: number | null;
    periodId: number;
    acceptedAt?: Date;
    processedDate?: Date | null;
    amountCents?: number;
  }) {
    const amountCents = opts.amountCents ?? 5_000;
    const { contactId, contributionId } = await makeContribution(prisma, {
      qomonContactId: nextContactId++,
      qomonTransactionId: nextTxId++,
      amountCents,
      acceptedAt: opts.acceptedAt,
    });
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contribution.update({ where: { id: contributionId }, data: {
          periodId: opts.periodId,
          entityKind: opts.entityKind,
          ridingNumber: opts.ridingNumber ?? null,
          receivedBy: 'GPO',
          processedDate: opts.processedDate,
        } });
      await ctx.log({ subjectType: 'Contribution', subjectId: contributionId, after });
    });
    return fixtureIssueReceipt(prisma, {
      contactId,
      contributionId,
      periodId: opts.periodId,
      amountCents,
      actorUserId: baseline.cfoUserId,
      entityKind: opts.entityKind,
      ridingNumber: opts.ridingNumber,
    });
  }

  const label = () => 'Green Party of Ontario';

  it('blocks ALL export (REP4) when a receipt is scoped to an entity that is not valid for its period', async () => {
    // CAMPAIGN during ANNUAL (baseline.periodId) is never eligible
    // (space/eligibility.ts) -- e.g. a period got edited after issuance.
    await prisma.riding.create({ data: { ridingNumber: 84, name: 'Parry Sound-Muskoka', qomonApiKey: 'x' } });
    await seedReceiptInto({ entityKind: 'CAMPAIGN', ridingNumber: 84, periodId: baseline.periodId });

    await expect(
      generateAllReport(
        { prisma, storageDir },
        {
          periodId: baseline.periodId,
          entityKind: 'CAMPAIGN',
          ridingNumber: 84,
          actorUserId: baseline.cfoUserId,
          reason: 'generate',
          politicalEntityLabel: label,
        },
      ),
    ).rejects.toThrow(ReportExportBlockedError);

    // Nothing partial gets written on a blocked export.
    expect(await prisma.entityReport.count()).toBe(0);
    expect(await prisma.artifact.count()).toBe(0);
  });

  it('blocks S2P2 export (REP4) identically, since both generators share the same gate', async () => {
    await prisma.riding.create({ data: { ridingNumber: 84, name: 'Parry Sound-Muskoka', qomonApiKey: 'x' } });
    await seedReceiptInto({
      entityKind: 'CAMPAIGN',
      ridingNumber: 84,
      periodId: baseline.periodId,
      amountCents: 30_000,
    });

    await expect(
      generateS2p2Report(
        { prisma, storageDir },
        {
          periodId: baseline.periodId,
          entityKind: 'CAMPAIGN',
          ridingNumber: 84,
          actorUserId: baseline.cfoUserId,
          reason: 'generate',
          politicalEntityLabel: label,
        },
      ),
    ).rejects.toThrow(ReportExportBlockedError);
  });

  it('blocks export (REP4) when the receipt is scoped to a riding EO no longer considers active', async () => {
    await prisma.riding.create({ data: { ridingNumber: 84, name: 'Parry Sound-Muskoka', qomonApiKey: 'x', active: false } });
    await seedReceiptInto({ entityKind: 'CA', ridingNumber: 84, periodId: baseline.periodId });

    await expect(
      generateAllReport(
        { prisma, storageDir },
        {
          periodId: baseline.periodId,
          entityKind: 'CA',
          ridingNumber: 84,
          actorUserId: baseline.cfoUserId,
          reason: 'generate',
          politicalEntityLabel: label,
        },
      ),
    ).rejects.toThrow(ReportExportBlockedError);
  });

  it('blocks export (REP6) when a receipt predates its own period window (drift after a period edit)', async () => {
    await seedReceiptInto({
      entityKind: 'PARTY',
      periodId: baseline.periodId,
      acceptedAt: new Date('2020-01-01T12:00:00Z'), // baseline period starts 2026-01-01
    });

    await expect(
      generateAllReport(
        { prisma, storageDir },
        {
          periodId: baseline.periodId,
          entityKind: 'PARTY',
          ridingNumber: null,
          actorUserId: baseline.cfoUserId,
          reason: 'generate',
          politicalEntityLabel: label,
        },
      ),
    ).rejects.toThrow(ReportExportBlockedError);
  });

  it('does not block on the REP6 receivable case -- it is a non-blocking flag, surfaced on the result', async () => {
    await seedReceiptInto({
      entityKind: 'PARTY',
      periodId: baseline.periodId,
      acceptedAt: new Date('2026-12-30T12:00:00Z'),
      processedDate: new Date('2027-01-02T12:00:00Z'),
    });

    const result = await generateAllReport(
      { prisma, storageDir },
      {
        periodId: baseline.periodId,
        entityKind: 'PARTY',
        ridingNumber: null,
        actorUserId: baseline.cfoUserId,
        reason: 'generate',
        politicalEntityLabel: label,
      },
    );

    expect(result.rowCount).toBe(1);
    expect(result.receivable).toHaveLength(1);
    expect(result.receivable[0]).toMatchObject({ acceptedYear: 2026, processedYear: 2027 });
  });

  it('passes a CAMPAIGN receipt scoped to a real election period', async () => {
    await prisma.riding.create({ data: { ridingNumber: 84, name: 'Parry Sound-Muskoka', qomonApiKey: 'x' } });
    const electionPeriodId = 9001;
    await prisma.period.create({
      data: {
        id: electionPeriodId,
        name: '2026 General Election',
        kind: 'GENERAL_ELECTION',
        startsAt: new Date('2026-01-01T05:00:00Z'),
        endsAt: new Date('2027-01-01T05:00:00Z'),
      },
    });
    await seedReceiptInto({ entityKind: 'CAMPAIGN', ridingNumber: 84, periodId: electionPeriodId });

    const result = await generateAllReport(
      { prisma, storageDir },
      {
        periodId: electionPeriodId,
        entityKind: 'CAMPAIGN',
        ridingNumber: 84,
        actorUserId: baseline.cfoUserId,
        reason: 'generate',
        politicalEntityLabel: label,
      },
    );
    expect(result.rowCount).toBe(1);
  });
});
