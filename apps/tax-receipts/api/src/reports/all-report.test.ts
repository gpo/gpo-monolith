import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import type { EntityKind } from '../generated/prisma/index.js';
import { makeContribution, issueReceipt as fixtureIssueReceipt, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import {
  AllReportScopeError,
  MissingContributionMetadataError,
  MultiAllocationReceiptError,
  generateAllReport,
} from './all-report.js';

const prisma = testPrisma();

describe('ALL report generator (ticket 4.1)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let storageDir: string;
  let nextContactId: bigint;
  let nextTxId: bigint;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-reports-test-'));
    nextContactId = 1n;
    nextTxId = 1n;
    await prisma.riding.create({
      data: { ridingNumber: 84, name: 'Parry Sound-Muskoka', qomonApiKey: 'x' },
    });
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  async function seedMetadata(
    contributionId: string,
    overrides: {
      entityKind?: EntityKind;
      ridingNumber?: number | null;
      receivedBy?: 'GPO' | 'ENTITY';
      goodsServices?: boolean;
      eoContributorId?: string | null;
      periodId?: number;
    } = {},
  ) {
    return withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contribution.update({ where: { id: contributionId }, data: {
          periodId: overrides.periodId ?? baseline.periodId,
          entityKind: overrides.entityKind ?? 'PARTY',
          ridingNumber: overrides.ridingNumber ?? null,
          receivedBy: overrides.receivedBy ?? 'GPO',
          goodsServices: overrides.goodsServices ?? false,
          eoContributorId: overrides.eoContributorId ?? null,
        } });
      await ctx.log({ subjectType: 'Contribution', subjectId: contributionId, after });
      return after;
    });
  }

  /** One contribution -> one receipt, with metadata, ready to report. */
  async function seedReportableReceipt(opts: {
    amountCents?: number;
    entityKind?: EntityKind;
    ridingNumber?: number | null;
    receivedBy?: 'GPO' | 'ENTITY';
    goodsServices?: boolean;
    eoContributorId?: string | null;
    status?: 'ISSUED' | 'CANCELLED' | 'VOID';
    contactFirstName?: string;
    contactLastName?: string;
    contactName?: string;
    periodId?: number;
  } = {}) {
    const amountCents = opts.amountCents ?? 5_000;
    const periodId = opts.periodId ?? baseline.periodId;
    // A caller supplying contactName (an org-only-style contact) means "no
    // name split" — don't fall back to the Dana Donor default in that case.
    const { contactId, contributionId } = await makeContribution(prisma, {
      qomonContactId: nextContactId++,
      qomonTransactionId: nextTxId++,
      amountCents,
      contactFirstName: opts.contactName ? opts.contactFirstName : opts.contactFirstName ?? 'Dana',
      contactLastName: opts.contactName ? opts.contactLastName : opts.contactLastName ?? 'Donor',
      contactName: opts.contactName,
    });
    await seedMetadata(contributionId, {
      entityKind: opts.entityKind,
      ridingNumber: opts.ridingNumber,
      receivedBy: opts.receivedBy,
      goodsServices: opts.goodsServices,
      eoContributorId: opts.eoContributorId,
      periodId,
    });
    const receiptId = await fixtureIssueReceipt(prisma, {
      contactId,
      contributionId,
      periodId,
      amountCents,
      actorUserId: baseline.cfoUserId,
      entityKind: opts.entityKind,
      ridingNumber: opts.ridingNumber,
      status: opts.status,
    });
    return { contactId, contributionId, receiptId };
  }

  const label = (space: { ridingNumber: number | null; entityKind: EntityKind }) =>
    space.entityKind === 'PARTY' ? 'Green Party of Ontario' : `084 Parry Sound Muskoka (${space.entityKind})`;

  it('generates a per-entity PARTY file with the expected CSV row', async () => {
    await seedReportableReceipt({ amountCents: 342_500, eoContributorId: '198176' });

    const result = await generateAllReport(
      { prisma, storageDir },
      {
        periodId: baseline.periodId,
        entityKind: 'PARTY',
        ridingNumber: null,
        actorUserId: baseline.cfoUserId,
        reason: 'generate ALL report',
        politicalEntityLabel: label,
      },
    );

    expect(result.rowCount).toBe(1);
    const lines = result.csv.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('8,198176,GPO-');
    expect(lines[1]).toContain(',I,N,N,P,Green Party of Ontario,3425.00,MO,');
    expect(lines[1]).toContain(',67,I,Donor,Dana,,1 Main St,Toronto,ON,M1M1M1');

    const stored = await prisma.entityReport.findUnique({ where: { id: result.entityReportId } });
    expect(stored?.entityKind).toBe('PARTY');
    expect(stored?.ridingNumber).toBeNull();
    expect(stored?.kind).toBe('ALL');
    expect(stored?.artifactId).toBe(result.artifactId);

    const links = await prisma.entityReportReceipt.findMany({ where: { entityReportId: result.entityReportId } });
    expect(links).toHaveLength(1);
  });

  it('generates the combined file across every entity in the period, with a null entityKind report row', async () => {
    // A CAMPAIGN entity is only ever eligible during an election period
    // (REP4, space/eligibility.ts) -- baseline.periodId is ANNUAL, so this
    // test needs its own GENERAL_ELECTION period for the export gate to pass.
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

    await seedReportableReceipt({ entityKind: 'PARTY', amountCents: 10_000, periodId: electionPeriodId });
    await seedReportableReceipt({
      entityKind: 'CA',
      ridingNumber: 84,
      amountCents: 20_000,
      receivedBy: 'GPO',
      periodId: electionPeriodId,
    });
    await seedReportableReceipt({
      entityKind: 'CAMPAIGN',
      ridingNumber: 84,
      amountCents: 30_000,
      receivedBy: 'ENTITY',
      periodId: electionPeriodId,
    });

    const result = await generateAllReport(
      { prisma, storageDir },
      {
        periodId: electionPeriodId,
        actorUserId: baseline.cfoUserId,
        reason: 'generate combined ALL report',
        politicalEntityLabel: label,
      },
    );

    expect(result.rowCount).toBe(3);
    const stored = await prisma.entityReport.findUnique({ where: { id: result.entityReportId } });
    expect(stored?.entityKind).toBeNull();
    expect(stored?.ridingNumber).toBeNull();

    const rows = result.csv.trimEnd().split('\n').slice(1);
    expect(rows.some((r) => r.includes(',P,Green Party of Ontario,'))).toBe(true);
    expect(rows.some((r) => r.includes(',A,084 Parry Sound Muskoka (CA),'))).toBe(true);
    expect(rows.some((r) => r.includes(',C,084 Parry Sound Muskoka (CAMPAIGN),'))).toBe(true);
  });

  it('derives Agency_Contribution = Y only when GPO received on behalf of a non-party entity', async () => {
    await seedReportableReceipt({ entityKind: 'CA', ridingNumber: 84, receivedBy: 'GPO' });

    const result = await generateAllReport(
      { prisma, storageDir },
      {
        periodId: baseline.periodId,
        entityKind: 'CA',
        ridingNumber: 84,
        actorUserId: baseline.cfoUserId,
        reason: 'generate',
        politicalEntityLabel: label,
      },
    );

    const row = result.csv.trimEnd().split('\n')[1]!;
    // ...,Receipt_Status,Agency_Contribution,General_Meetings,Political_Entity_Type,... => "...,I,Y,N,A,..."
    expect(row).toContain(',I,Y,N,A,');
  });

  it('files an issued receipt flagged lost as status L (O41, EO spec column D)', async () => {
    const { receiptId } = await seedReportableReceipt({ amountCents: 4_000 });
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'donor lost the receipt' }, async (ctx) => {
      await ctx.tx.receipt.update({ where: { id: receiptId }, data: { lost: true } });
      await ctx.log({ subjectType: 'Receipt', subjectId: receiptId, before: { lost: false }, after: { lost: true } });
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

    const row = result.csv.trimEnd().split('\n')[1]!;
    expect(row).toContain(',L,N,N,P,');
    expect(row).toContain(',40.00,');
  });

  it('retains a cancelled receipt as a full-value row with status C (REP7)', async () => {
    await seedReportableReceipt({ amountCents: 7_500, status: 'CANCELLED' });

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

    const row = result.csv.trimEnd().split('\n')[1]!;
    expect(row).toContain(',C,N,N,P,'); // Receipt_Status=C
    expect(row).toContain(',75.00,'); // full value retained, not zeroed
  });

  it('marks G&S contributions as GS even though they are not cash-receipted', async () => {
    await seedReportableReceipt({ goodsServices: true });
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
    expect(result.csv).toContain(',GS,');
  });

  it('rejects a half-specified scope (riding without entity kind)', async () => {
    await expect(
      generateAllReport(
        { prisma, storageDir },
        {
          periodId: baseline.periodId,
          ridingNumber: 84,
          actorUserId: baseline.cfoUserId,
          reason: 'generate',
          politicalEntityLabel: label,
        },
      ),
    ).rejects.toThrow(AllReportScopeError);
  });

  it('throws MissingContributionMetadataError rather than skip or fabricate metadata', async () => {
    const { contactId, contributionId } = await makeContribution(prisma, {
      qomonContactId: nextContactId++,
      qomonTransactionId: nextTxId++,
      amountCents: 5_000,
    });
    // No seedMetadata call: intake derivation "hasn't resolved this row yet".
    // The test/db.ts fixture helper writes the receipt/allocation directly
    // (unlike the real issueReceipt service, it doesn't require metadata),
    // so this row exists with no period — exactly the case the
    // generator must refuse to guess through.
    await fixtureIssueReceipt(prisma, {
      contactId,
      contributionId,
      periodId: baseline.periodId,
      amountCents: 5_000,
      actorUserId: baseline.cfoUserId,
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
    ).rejects.toThrow(MissingContributionMetadataError);
  });

  it('throws MultiAllocationReceiptError on a consolidated receipt (not yet supported)', async () => {
    const { contactId, contributionId } = await seedReportableReceipt({});
    const { contributionId: secondContributionId } = await makeContribution(prisma, {
      qomonContactId: nextContactId++,
      qomonTransactionId: nextTxId++,
      amountCents: 1_000,
    });
    await seedMetadata(secondContributionId);

    const receipt = await prisma.receipt.findFirst({ where: { contactId } });
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'consolidate onto one receipt' }, async (ctx) => {
      const allocation = await ctx.tx.receiptAllocation.create({
        data: { receiptId: receipt!.id, contributionId: secondContributionId, amountCents: 1_000 },
      });
      await ctx.log({ subjectType: 'ReceiptAllocation', subjectId: allocation.id, after: allocation });
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
    ).rejects.toThrow(MultiAllocationReceiptError);
    void contributionId;
  });

  it('falls back to the joined display name when Qomon never supplied a name split', async () => {
    await seedReportableReceipt({ contactName: 'Org Only' });

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
    expect(result.csv).toContain(',Org Only,,'); // last-name slot carries the joined name, first blank
  });
});
