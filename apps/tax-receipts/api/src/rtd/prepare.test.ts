import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import { makeContribution, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { RtdExportBlockedError, RtdPrepareSelectionError, prepareRtdFiling } from './prepare.js';

const prisma = testPrisma();

describe('RTD filing prepare, DB-backed (redesigned from tickets 2.3/2.6)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let storageDir: string;
  let nextContactId: bigint;
  let nextTxId: bigint;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-rtd-prepare-test-'));
    nextContactId = 1n;
    nextTxId = 1n;
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  async function seedMetadata(contributionId: string, eoContributorId: string | null = null) {
    return withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contribution.update({ where: { id: contributionId }, data: {
          periodId: baseline.periodId,
          entityKind: 'PARTY',
          ridingNumber: null,
          receivedBy: 'GPO',
          goodsServices: false,
          eoContributorId,
        } });
      await ctx.log({ subjectType: 'Contribution', subjectId: contributionId, after });
      return after;
    });
  }

  /** An over-threshold, unreported party deposit — a draft candidate on its
   *  own (single-contribution aggregate above the $200 disclosure line). */
  async function seedDraftCandidate(opts: {
    amountCents?: number;
    acceptedAt?: Date;
    lastName?: string;
    firstName?: string;
    eoContributorId?: string | null;
  } = {}) {
    const made = await makeContribution(prisma, {
      qomonContactId: nextContactId++,
      qomonTransactionId: nextTxId++,
      amountCents: opts.amountCents ?? 25_000,
      acceptedAt: opts.acceptedAt ?? new Date('2026-03-01T12:00:00Z'),
      contactFirstName: opts.firstName ?? 'Dana',
      contactLastName: opts.lastName ?? 'Donor',
    });
    await seedMetadata(made.contributionId, opts.eoContributorId ?? null);
    return made;
  }

  it('prepares the selected rows into a new RtdFiling with matching RtdInclusion rows, unsubmitted', async () => {
    const a = await seedDraftCandidate({ amountCents: 25_000, acceptedAt: new Date('2026-03-01T12:00:00Z') });
    const b = await seedDraftCandidate({ amountCents: 30_000, acceptedAt: new Date('2026-03-05T12:00:00Z') });

    const result = await prepareRtdFiling(
      { prisma, storageDir },
      {
        year: 2026,
        contributionIds: [a.contributionId, b.contributionId],
        actorUserId: baseline.cfoUserId,
        reason: 'first RTD filing',
        cfoName: 'Casey CFO',
        asOf: new Date('2026-03-06T15:00:00Z'),
      },
    );

    expect(result.preparedCount).toBe(2);
    expect(result.filingName).toBe('2026_RTD_8_030620261000');
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.byteSize).toBeGreaterThan(0);

    const filing = await prisma.rtdFiling.findUnique({
      where: { id: result.rtdFilingId },
      include: { inclusions: true, artifact: true },
    });
    expect(filing?.kind).toBe('INITIAL');
    expect(filing?.format).toBe('CSV');
    expect(filing?.submittedAt).toBeNull();
    expect(filing?.submittedBy).toBeNull();
    expect(filing?.artifactId).toBe(result.artifactId);
    expect(filing?.artifact?.sha256).toBe(result.sha256);
    expect(filing?.inclusions).toHaveLength(2);
    expect(filing?.inclusions.map((i) => i.contributionId).sort()).toEqual(
      [a.contributionId, b.contributionId].sort(),
    );

    const entry = await prisma.changeLogEntry.findFirst({
      where: { subjectType: 'RtdFiling', subjectId: result.rtdFilingId },
    });
    expect(entry?.reason).toBe('first RTD filing');
  });

  it('renders the exact header and row content, with the CFO name and blank Contributor ID', async () => {
    const a = await seedDraftCandidate({ amountCents: 20_001, lastName: 'Donor', firstName: 'Dana' });
    const result = await prepareRtdFiling(
      { prisma, storageDir },
      {
        year: 2026,
        contributionIds: [a.contributionId],
        actorUserId: baseline.cfoUserId,
        reason: 'prepare it',
        cfoName: 'Casey CFO',
        asOf: new Date('2026-03-06T15:00:00Z'),
      },
    );
    const artifact = await prisma.artifact.findUniqueOrThrow({ where: { id: result.artifactId } });
    const bytes = await readFile(path.join(storageDir, artifact.uri), 'utf8');
    const lines = bytes.trim().split('\n');
    expect(lines[0]).toBe(
      'Entity ID,CFO Name,Contribution Year,Contribution Period ID,Contributor Last Name,' +
        'Contributor First Name,Deposit Date,Contribution Amount,Aggregate Contribution Amount,Contributor ID',
    );
    expect(lines[1]).toBe('8,Casey CFO,2026,67,Donor,Dana,03012026,200.01,200.01,');
  });

  it('orders rows chronologically by acceptance date regardless of selection order', async () => {
    const later = await seedDraftCandidate({ amountCents: 25_000, acceptedAt: new Date('2026-03-05T12:00:00Z'), lastName: 'Later' });
    const earlier = await seedDraftCandidate({ amountCents: 25_000, acceptedAt: new Date('2026-03-01T12:00:00Z'), lastName: 'Earlier' });

    const result = await prepareRtdFiling(
      { prisma, storageDir },
      {
        year: 2026,
        contributionIds: [later.contributionId, earlier.contributionId],
        actorUserId: baseline.cfoUserId,
        reason: 'two rows',
        cfoName: 'Casey CFO',
        asOf: new Date('2026-03-06T15:00:00Z'),
      },
    );
    const artifact = await prisma.artifact.findUniqueOrThrow({ where: { id: result.artifactId } });
    const bytes = await readFile(path.join(storageDir, artifact.uri), 'utf8');
    const lines = bytes.trim().split('\n').slice(1);
    expect(lines[0]).toContain('Earlier');
    expect(lines[1]).toContain('Later');
  });

  it('prepares a PIPE-format filing when requested, defaulting to CSV otherwise', async () => {
    const a = await seedDraftCandidate();
    const result = await prepareRtdFiling(
      { prisma, storageDir },
      {
        year: 2026,
        contributionIds: [a.contributionId],
        actorUserId: baseline.cfoUserId,
        reason: 'pipe format filing',
        cfoName: 'Casey CFO',
        format: 'PIPE',
      },
    );
    const filing = await prisma.rtdFiling.findUnique({ where: { id: result.rtdFilingId } });
    expect(filing?.format).toBe('PIPE');
  });

  it('an already-included contribution drops out of the next draft, so double-preparing it fails as an invalid selection', async () => {
    const a = await seedDraftCandidate();
    await prepareRtdFiling(
      { prisma, storageDir },
      {
        year: 2026,
        contributionIds: [a.contributionId],
        actorUserId: baseline.cfoUserId,
        reason: 'first filing',
        cfoName: 'Casey CFO',
        asOf: new Date('2026-03-06T15:00:00Z'),
      },
    );

    await expect(
      prepareRtdFiling(
        { prisma, storageDir },
        {
          year: 2026,
          contributionIds: [a.contributionId],
          actorUserId: baseline.cfoUserId,
          reason: 'accidental re-prepare',
          cfoName: 'Casey CFO',
          asOf: new Date('2026-03-07T15:00:00Z'),
        },
      ),
    ).rejects.toThrow(RtdPrepareSelectionError);

    expect(await prisma.rtdFiling.count()).toBe(1);
  });

  it('rejects a selection that includes an id outside the current draft', async () => {
    const a = await seedDraftCandidate();
    await expect(
      prepareRtdFiling(
        { prisma, storageDir },
        {
          year: 2026,
          contributionIds: [a.contributionId, 'not-a-real-id'],
          actorUserId: baseline.cfoUserId,
          reason: 'bad selection',
          cfoName: 'Casey CFO',
        },
      ),
    ).rejects.toThrow(RtdPrepareSelectionError);
    expect(await prisma.rtdFiling.count()).toBe(0);
  });

  it('rejects an empty selection', async () => {
    await expect(
      prepareRtdFiling(
        { prisma, storageDir },
        {
          year: 2026,
          contributionIds: [],
          actorUserId: baseline.cfoUserId,
          reason: 'nothing selected',
          cfoName: 'Casey CFO',
        },
      ),
    ).rejects.toThrow(RtdPrepareSelectionError);
  });

  it('blocks a selection with an open RTD-gate finding, preparing nothing', async () => {
    const clean = await seedDraftCandidate({ amountCents: 25_000, acceptedAt: new Date('2026-03-01T12:00:00Z') });
    const flagged = await seedDraftCandidate({ amountCents: 25_000, acceptedAt: new Date('2026-03-02T12:00:00Z') });
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
      prepareRtdFiling(
        { prisma, storageDir },
        {
          year: 2026,
          contributionIds: [clean.contributionId, flagged.contributionId],
          actorUserId: baseline.cfoUserId,
          reason: 'includes a blocked row',
          cfoName: 'Casey CFO',
        },
      ),
    ).rejects.toThrow(RtdExportBlockedError);
    expect(await prisma.rtdFiling.count()).toBe(0);
  });

  it('lets the filer hold a blocked row back and prepare only the clean selection', async () => {
    const clean = await seedDraftCandidate({ amountCents: 25_000, acceptedAt: new Date('2026-03-01T12:00:00Z') });
    const flagged = await seedDraftCandidate({ amountCents: 25_000, acceptedAt: new Date('2026-03-02T12:00:00Z') });
    await prisma.workItem.create({
      data: {
        kind: 'VALIDATION',
        subjectType: 'Contribution',
        subjectId: flagged.contributionId,
        contactId: flagged.contactId,
        ruleRef: 'B1',
      },
    });

    const result = await prepareRtdFiling(
      { prisma, storageDir },
      {
        year: 2026,
        contributionIds: [clean.contributionId],
        actorUserId: baseline.cfoUserId,
        reason: 'preparing the clean row only',
        cfoName: 'Casey CFO',
      },
    );
    expect(result.preparedCount).toBe(1);

    const inclusion = await prisma.rtdInclusion.findFirst({ where: { contributionId: clean.contributionId } });
    expect(inclusion).not.toBeNull();
    const stillUnreported = await prisma.rtdInclusion.findFirst({ where: { contributionId: flagged.contributionId } });
    expect(stillUnreported).toBeNull();
  });
});
