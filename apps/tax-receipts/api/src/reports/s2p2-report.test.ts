import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import type { EntityKind } from '../generated/prisma/index.js';
import { makeContribution, issueReceipt as fixtureIssueReceipt, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { generateS2p2Report } from './s2p2-report.js';

const prisma = testPrisma();

describe('S2P2 report generator (ticket 4.2)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let storageDir: string;
  let nextContactId: bigint;
  let nextTxId: bigint;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-s2p2-test-'));
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
      eoContributorId?: string | null;
    } = {},
  ) {
    return withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contributionMetadata.create({
        data: {
          contributionId,
          periodId: baseline.periodId,
          entityKind: overrides.entityKind ?? 'PARTY',
          ridingNumber: overrides.ridingNumber ?? null,
          receivedBy: 'GPO',
          eoContributorId: overrides.eoContributorId ?? null,
        },
      });
      await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contributionId, after });
      return after;
    });
  }

  /** One contribution -> one receipt, with metadata, ready to report. */
  async function seedReportableReceipt(opts: {
    amountCents?: number;
    entityKind?: EntityKind;
    ridingNumber?: number | null;
    eoContributorId?: string | null;
    status?: 'ISSUED' | 'CANCELLED' | 'VOID';
    contactLastName?: string;
    /** reuse the same donor across several calls, to build up an aggregate. */
    contactId?: string;
    contributionSeed?: { contactId: string };
  } = {}) {
    const amountCents = opts.amountCents ?? 5_000;
    let contactId: string;
    let contributionId: string;
    if (opts.contributionSeed) {
      contactId = opts.contributionSeed.contactId;
      const contribution = await prisma.contribution.create({
        data: {
          qomonTransactionId: nextTxId++,
          contactId,
          amountCents,
          acceptedAt: new Date('2026-03-01T12:00:00Z'),
        },
      });
      contributionId = contribution.id;
    } else {
      const made = await makeContribution(prisma, {
        qomonContactId: nextContactId++,
        qomonTransactionId: nextTxId++,
        amountCents,
        contactFirstName: 'Dana',
        contactLastName: opts.contactLastName ?? 'Donor',
      });
      contactId = made.contactId;
      contributionId = made.contributionId;
    }
    await seedMetadata(contributionId, {
      entityKind: opts.entityKind,
      ridingNumber: opts.ridingNumber,
      eoContributorId: opts.eoContributorId,
    });
    const receiptId = await fixtureIssueReceipt(prisma, {
      contactId,
      contributionId,
      periodId: baseline.periodId,
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

  it('aggregates two receipts for the same donor into one row over $200', async () => {
    const first = await seedReportableReceipt({ amountCents: 15_000, eoContributorId: '198176' });
    await seedReportableReceipt({ amountCents: 10_000, contributionSeed: { contactId: first.contactId } });

    const result = await generateS2p2Report(
      { prisma, storageDir },
      {
        periodId: baseline.periodId,
        entityKind: 'PARTY',
        ridingNumber: null,
        actorUserId: baseline.cfoUserId,
        reason: 'generate S2P2',
        politicalEntityLabel: label,
      },
    );

    expect(result.rowCount).toBe(1);
    expect(result.entityReportId).not.toBeNull();
    const lines = result.csv!.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    // Party_ID,Contributor_ID,Political_Entity_Type,Political_Entity,Contribution_Period_ID,
    // Contributor_Type,Last,First,Org,Address,City,Province,Postal,Aggregate
    expect(lines[1]).toBe(
      '8,198176,P,Green Party of Ontario,67,P,Donor,Dana,,1 Main St,Toronto,ON,M1M1M1,250.00',
    );

    const stored = await prisma.entityReport.findUnique({ where: { id: result.entityReportId! } });
    expect(stored?.kind).toBe('S2P2');
    const links = await prisma.entityReportReceipt.findMany({ where: { entityReportId: result.entityReportId! } });
    expect(links).toHaveLength(2); // both receipts fed the surviving group
  });

  it('emits no report at all when nothing in scope exceeds $200 (no file, not an empty one)', async () => {
    await seedReportableReceipt({ amountCents: 5_000 });

    const result = await generateS2p2Report(
      { prisma, storageDir },
      {
        periodId: baseline.periodId,
        entityKind: 'PARTY',
        ridingNumber: null,
        actorUserId: baseline.cfoUserId,
        reason: 'generate S2P2',
        politicalEntityLabel: label,
      },
    );

    expect(result.rowCount).toBe(0);
    expect(result.entityReportId).toBeNull();
    expect(result.artifactId).toBeNull();
    expect(result.csv).toBeNull();
    expect(await prisma.entityReport.count()).toBe(0);
    expect(await prisma.artifact.count()).toBe(0);
  });

  it('excludes a cancelled receipt from the aggregate, dropping it below $200 and out of the file', async () => {
    const first = await seedReportableReceipt({ amountCents: 15_000 });
    await seedReportableReceipt({
      amountCents: 10_000,
      contributionSeed: { contactId: first.contactId },
      status: 'CANCELLED',
    });

    const result = await generateS2p2Report(
      { prisma, storageDir },
      {
        periodId: baseline.periodId,
        entityKind: 'PARTY',
        ridingNumber: null,
        actorUserId: baseline.cfoUserId,
        reason: 'generate S2P2',
        politicalEntityLabel: label,
      },
    );

    // $150 issued + $100 cancelled -- REP7 excludes the cancelled row, so the
    // real aggregate ($150) never clears $200: no file.
    expect(result.rowCount).toBe(0);
    expect(result.entityReportId).toBeNull();
  });

  it('generates the combined file across every entity, separating distinct donors', async () => {
    await seedReportableReceipt({ amountCents: 25_000, entityKind: 'PARTY', contactLastName: 'Alpha' });
    await seedReportableReceipt({
      amountCents: 25_000,
      entityKind: 'CA',
      ridingNumber: 84,
      contactLastName: 'Beta',
    });

    const result = await generateS2p2Report(
      { prisma, storageDir },
      {
        periodId: baseline.periodId,
        actorUserId: baseline.cfoUserId,
        reason: 'generate combined S2P2',
        politicalEntityLabel: label,
      },
    );

    expect(result.rowCount).toBe(2);
    const stored = await prisma.entityReport.findUnique({ where: { id: result.entityReportId! } });
    expect(stored?.entityKind).toBeNull();
    expect(stored?.ridingNumber).toBeNull();
  });
});
