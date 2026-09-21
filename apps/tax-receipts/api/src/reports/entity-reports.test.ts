import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import type { EntityKind } from '../generated/prisma/index.js';
import { makeContribution, issueReceipt as fixtureIssueReceipt, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { generateAllReport } from './all-report.js';
import { checkEntityReportDrift, listEntityReports, markEntityReportSentToCfo } from './entity-reports.js';

const prisma = testPrisma();

describe('entity reports: listing, drift, send-to-CFO (ticket 4.5)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let storageDir: string;
  let nextContactId: bigint;
  let nextTxId: bigint;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-entity-reports-test-'));
    nextContactId = 1n;
    nextTxId = 1n;
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  async function seedReportableReceipt(opts: { amountCents?: number; eoContributorId?: string | null } = {}) {
    const amountCents = opts.amountCents ?? 5_000;
    const { contactId, contributionId } = await makeContribution(prisma, {
      qomonContactId: nextContactId++,
      qomonTransactionId: nextTxId++,
      amountCents,
      contactFirstName: 'Dana',
      contactLastName: 'Donor',
    });
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contributionMetadata.create({
        data: {
          contributionId,
          periodId: baseline.periodId,
          entityKind: 'PARTY',
          receivedBy: 'GPO',
          eoContributorId: opts.eoContributorId ?? null,
        },
      });
      await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contributionId, after });
    });
    return fixtureIssueReceipt(prisma, {
      contactId,
      contributionId,
      periodId: baseline.periodId,
      amountCents,
      actorUserId: baseline.cfoUserId,
      entityKind: 'PARTY' as EntityKind,
    });
  }

  const label = () => 'Green Party of Ontario';

  it('lists a generated report as clean immediately after generation', async () => {
    await seedReportableReceipt();
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

    const list = await listEntityReports(prisma, baseline.periodId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: result.entityReportId, kind: 'ALL', rowCount: 1, dirty: false });
  });

  it('flags a report dirty once a later metadata edit changes a rendered field (rule E5)', async () => {
    const receiptId = await seedReportableReceipt();
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

    // Simulate the "year-later auditor" case: eoContributorId assigned after
    // the report already went out.
    const allocation = await prisma.receiptAllocation.findFirstOrThrow({ where: { receiptId } });
    const contributionId = allocation.contributionId;
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'assign contributor id' }, async (ctx) => {
      const after = await ctx.tx.contributionMetadata.update({
        where: { contributionId },
        data: { eoContributorId: '198176' },
      });
      await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contributionId, after });
    });

    const list = await listEntityReports(prisma, baseline.periodId);
    expect(list[0]!.dirty).toBe(true);

    const drift = await checkEntityReportDrift(prisma, {
      kind: 'ALL',
      periodId: baseline.periodId,
      ridingNumber: null,
      entityKind: 'PARTY',
      includedSet: (await prisma.entityReport.findUniqueOrThrow({ where: { id: result.entityReportId } })).includedSet,
    });
    expect(drift.status).toBe('dirty');
    expect(drift.diff?.changed).toHaveLength(1);
    expect(drift.diff?.changed[0]!.fields.map((f) => f.field)).toContain('Contributor_ID');
  });

  it('does not flag a report dirty when nothing about its included rows changed', async () => {
    await seedReportableReceipt();
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

    // A second, unrelated receipt appears -- shouldn't dirty the first report.
    await seedReportableReceipt({ amountCents: 1_000 });

    const list = await listEntityReports(prisma, baseline.periodId);
    expect(list.find((r) => r.id === result.entityReportId)!.dirty).toBe(false);
  });

  it('never drift-checks a combined report (no single label to rebuild against)', async () => {
    await seedReportableReceipt();
    const result = await generateAllReport(
      { prisma, storageDir },
      {
        periodId: baseline.periodId,
        actorUserId: baseline.cfoUserId,
        reason: 'generate combined',
        politicalEntityLabel: label,
      },
    );

    const list = await listEntityReports(prisma, baseline.periodId);
    expect(list.find((r) => r.id === result.entityReportId)!.dirty).toBeNull();
  });

  it('marks a report sent to CFO with a timestamp and a change-log entry', async () => {
    await seedReportableReceipt();
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

    const before = await prisma.entityReport.findUniqueOrThrow({ where: { id: result.entityReportId } });
    expect(before.sentToCfoAt).toBeNull();

    const updated = await markEntityReportSentToCfo(prisma, result.entityReportId, baseline.cfoUserId, 'emailed to CFO');
    expect(updated.sentToCfoAt).not.toBeNull();

    const entries = await prisma.changeLogEntry.findMany({
      where: { subjectType: 'EntityReport', subjectId: result.entityReportId },
    });
    expect(entries.some((e) => e.reason === 'emailed to CFO')).toBe(true);
  });
});
