import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import { makeContribution, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { stampRtdFiling } from './stamp.js';
import {
  AmendmentWorkItemError,
  ContributionNotRtdReportedError,
  generateDc1aAmendment,
} from './dc1a.js';

const prisma = testPrisma();

describe('DC-1A amendment generation, DB-backed (ticket 2.4)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let storageDir: string;
  let nextContactId: bigint;
  let nextTxId: bigint;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-dc1a-test-'));
    nextContactId = 1n;
    nextTxId = 1n;
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
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

  async function seedReportedContribution(amountCents = 25_000, acceptedAt = new Date('2026-03-01T12:00:00Z')) {
    const made = await makeContribution(prisma, {
      qomonContactId: nextContactId++,
      qomonTransactionId: nextTxId++,
      amountCents,
      acceptedAt,
      contactFirstName: 'Dana',
      contactLastName: 'Donor',
    });
    await seedMetadata(made.contributionId);
    const stamped = await stampRtdFiling(prisma, {
      year: 2026,
      contributionIds: [made.contributionId],
      actorUserId: baseline.cfoUserId,
      reason: 'initial filing',
      asOf: new Date('2026-03-06T15:00:00Z'),
    });
    return { ...made, stamped };
  }

  it('generates a DC1A_AMENDMENT filing that links back to the original', async () => {
    const donor = await seedReportedContribution();

    const result = await generateDc1aAmendment(
      { prisma, storageDir },
      {
        contributionId: donor.contributionId,
        reason: 'amount corrected after bank reconciliation',
        actorUserId: baseline.cfoUserId,
        asOf: new Date('2026-04-01T14:00:00Z'),
      },
    );

    const filing = await prisma.rtdFiling.findUnique({ where: { id: result.rtdFilingId } });
    expect(filing?.kind).toBe('DC1A_AMENDMENT');
    expect(filing?.amendsFilingId).toBe(donor.stamped.rtdFilingId);

    const form = await prisma.eOForm.findUnique({ where: { id: result.eoFormId } });
    expect(form?.kind).toBe('DC1A');
    expect(form?.rtdFilingId).toBe(result.rtdFilingId);
    expect(form?.artifactId).toBe(result.artifactId);
  });

  it('never collides with an INITIAL filing stamped in the same minute (RtdFiling.name is unique)', async () => {
    // Same disclosure year and the same asOf minute buildRtdFilingName
    // would otherwise render identically for both filings.
    const donor = await seedReportedContribution(25_000, new Date('2026-03-01T12:00:00Z'));
    const result = await generateDc1aAmendment(
      { prisma, storageDir },
      {
        contributionId: donor.contributionId,
        reason: 'amount corrected',
        actorUserId: baseline.cfoUserId,
        asOf: new Date('2026-03-06T15:00:00Z'), // same instant as seedReportedContribution's stamp
      },
    );
    expect(result.filingName).not.toBe(donor.stamped.filingName);
    expect(result.filingName).toBe(`${donor.stamped.filingName}_DC1A`);
  });

  it('renders the original record and reason into the form artifact', async () => {
    const donor = await seedReportedContribution(25_000, new Date('2026-03-01T12:00:00Z'));
    const result = await generateDc1aAmendment(
      { prisma, storageDir },
      {
        contributionId: donor.contributionId,
        reason: 'amount corrected after bank reconciliation',
        actorUserId: baseline.cfoUserId,
        asOf: new Date('2026-04-01T14:00:00Z'),
      },
    );
    const artifact = await prisma.artifact.findUniqueOrThrow({ where: { id: result.artifactId } });
    expect(artifact.kind).toBe('FORM');
    const text = await readFile(path.join(storageDir, artifact.uri), 'utf8');
    expect(text).toContain('Original filing: 2026_RTD_8_030620261000');
    expect(text).toContain('Contributor: Dana Donor');
    expect(text).toContain('Contribution Amount: 250.00');
    expect(text).toContain('Reason for amendment:\namount corrected after bank reconciliation');
  });

  it('rejects a contribution that was never RTD-reported', async () => {
    const made = await makeContribution(prisma, {
      qomonContactId: nextContactId++,
      qomonTransactionId: nextTxId++,
      amountCents: 25_000,
      acceptedAt: new Date('2026-03-01T12:00:00Z'),
    });
    await seedMetadata(made.contributionId);

    await expect(
      generateDc1aAmendment(
        { prisma, storageDir },
        { contributionId: made.contributionId, reason: 'never reported', actorUserId: baseline.cfoUserId },
      ),
    ).rejects.toThrow(ContributionNotRtdReportedError);
  });

  it('resolves a given OWED_TO_EO work item, attaching the form artifact', async () => {
    const donor = await seedReportedContribution();
    const workItem = await prisma.workItem.create({
      data: {
        kind: 'OWED_TO_EO',
        subjectType: 'Contribution',
        subjectId: donor.contributionId,
        contactId: donor.contactId,
        ruleRef: 'E2',
      },
    });

    const result = await generateDc1aAmendment(
      { prisma, storageDir },
      {
        contributionId: donor.contributionId,
        reason: 'closing the owed-to-EO item',
        actorUserId: baseline.cfoUserId,
        workItemId: workItem.id,
      },
    );

    const updated = await prisma.workItem.findUnique({ where: { id: workItem.id } });
    expect(updated?.status).toBe('RESOLVED');
    expect(updated?.formArtifactId).toBe(result.artifactId);
  });

  it('rejects a work item that is not OWED_TO_EO kind, or not open', async () => {
    const donor = await seedReportedContribution();
    const wrongKind = await prisma.workItem.create({
      data: { kind: 'VALIDATION', subjectType: 'Contribution', subjectId: donor.contributionId, ruleRef: 'A1' },
    });
    await expect(
      generateDc1aAmendment(
        { prisma, storageDir },
        { contributionId: donor.contributionId, reason: 'x', actorUserId: baseline.cfoUserId, workItemId: wrongKind.id },
      ),
    ).rejects.toThrow(AmendmentWorkItemError);

    const alreadyClosed = await prisma.workItem.create({
      data: {
        kind: 'OWED_TO_EO',
        subjectType: 'Contribution',
        subjectId: donor.contributionId,
        status: 'RESOLVED',
        closedAt: new Date(),
      },
    });
    await expect(
      generateDc1aAmendment(
        { prisma, storageDir },
        {
          contributionId: donor.contributionId,
          reason: 'x',
          actorUserId: baseline.cfoUserId,
          workItemId: alreadyClosed.id,
        },
      ),
    ).rejects.toThrow(AmendmentWorkItemError);
  });

  it('a second amendment still links back to the ORIGINAL filing, not the first amendment', async () => {
    const donor = await seedReportedContribution();
    const first = await generateDc1aAmendment(
      { prisma, storageDir },
      { contributionId: donor.contributionId, reason: 'first correction', actorUserId: baseline.cfoUserId, asOf: new Date('2026-04-01T14:00:00Z') },
    );
    const second = await generateDc1aAmendment(
      { prisma, storageDir },
      { contributionId: donor.contributionId, reason: 'second correction', actorUserId: baseline.cfoUserId, asOf: new Date('2026-05-01T14:00:00Z') },
    );

    const firstFiling = await prisma.rtdFiling.findUnique({ where: { id: first.rtdFilingId } });
    const secondFiling = await prisma.rtdFiling.findUnique({ where: { id: second.rtdFilingId } });
    expect(firstFiling?.amendsFilingId).toBe(donor.stamped.rtdFilingId);
    expect(secondFiling?.amendsFilingId).toBe(donor.stamped.rtdFilingId);
  });
});
