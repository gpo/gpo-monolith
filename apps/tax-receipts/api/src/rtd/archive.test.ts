import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import { makeContribution, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { stampRtdFiling } from './stamp.js';
import {
  RtdFilingAlreadyArchivedError,
  RtdFilingNotFoundError,
  UnsupportedFilingKindError,
  archiveRtdFiling,
} from './archive.js';

const prisma = testPrisma();

describe('RTD filing archive, DB-backed (ticket 2.6)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let storageDir: string;
  let nextContactId: bigint;
  let nextTxId: bigint;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-rtd-archive-test-'));
    nextContactId = 1n;
    nextTxId = 1n;
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  async function seedMetadata(contributionId: string, eoContributorId: string | null = null) {
    return withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contributionMetadata.create({
        data: {
          contributionId,
          periodId: baseline.periodId,
          entityKind: 'PARTY',
          ridingNumber: null,
          receivedBy: 'GPO',
          goodsServices: false,
          eoContributorId,
        },
      });
      await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contributionId, after });
      return after;
    });
  }

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

  async function stampOne(opts: Parameters<typeof seedDraftCandidate>[0] = {}) {
    const candidate = await seedDraftCandidate(opts);
    const stamped = await stampRtdFiling(prisma, {
      year: 2026,
      contributionIds: [candidate.contributionId],
      actorUserId: baseline.cfoUserId,
      reason: 'stamp for archive test',
      asOf: new Date('2026-03-06T15:00:00Z'),
    });
    return { candidate, stamped };
  }

  it('archives a stamped filing as a content-hashed CSV artifact', async () => {
    const { stamped } = await stampOne({ amountCents: 20_001, lastName: 'Donor', firstName: 'Dana' });

    const result = await archiveRtdFiling(
      { prisma, storageDir },
      { rtdFilingId: stamped.rtdFilingId, cfoName: 'Casey CFO', actorUserId: baseline.cfoUserId, reason: 'archive it' },
    );

    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.byteSize).toBeGreaterThan(0);

    const filing = await prisma.rtdFiling.findUnique({ where: { id: stamped.rtdFilingId }, include: { artifact: true } });
    expect(filing?.artifactId).toBe(result.artifactId);
    expect(filing?.artifact?.sha256).toBe(result.sha256);
    expect(filing?.artifact?.kind).toBe('CSV');

    const entry = await prisma.changeLogEntry.findFirst({
      where: { subjectType: 'RtdFiling', subjectId: stamped.rtdFilingId, reason: 'archive it' },
    });
    expect(entry).not.toBeNull();
  });

  it('renders the exact header and row content, with the CFO name and blank Contributor ID', async () => {
    const { stamped } = await stampOne({ amountCents: 20_001, lastName: 'Donor', firstName: 'Dana' });
    const result = await archiveRtdFiling(
      { prisma, storageDir },
      { rtdFilingId: stamped.rtdFilingId, cfoName: 'Casey CFO', actorUserId: baseline.cfoUserId, reason: 'archive it' },
    );
    const artifact = await prisma.artifact.findUniqueOrThrow({ where: { id: result.artifactId } });
    const bytes = await import('node:fs/promises').then((fs) => fs.readFile(path.join(storageDir, artifact.uri), 'utf8'));
    const lines = bytes.trim().split('\n');
    expect(lines[0]).toBe(
      'Entity ID,CFO Name,Contribution Year,Contribution Period ID,Contributor Last Name,' +
        'Contributor First Name,Deposit Date,Contribution Amount,Aggregate Contribution Amount,Contributor ID',
    );
    expect(lines[1]).toBe('8,Casey CFO,2026,67,Donor,Dana,03012026,200.01,200.01,');
  });

  it('orders rows chronologically by acceptance date regardless of stamp order', async () => {
    const later = await seedDraftCandidate({ amountCents: 25_000, acceptedAt: new Date('2026-03-05T12:00:00Z'), lastName: 'Later' });
    const earlier = await seedDraftCandidate({ amountCents: 25_000, acceptedAt: new Date('2026-03-01T12:00:00Z'), lastName: 'Earlier' });
    const stamped = await stampRtdFiling(prisma, {
      year: 2026,
      contributionIds: [later.contributionId, earlier.contributionId],
      actorUserId: baseline.cfoUserId,
      reason: 'two rows',
      asOf: new Date('2026-03-06T15:00:00Z'),
    });

    const result = await archiveRtdFiling(
      { prisma, storageDir },
      { rtdFilingId: stamped.rtdFilingId, cfoName: 'Casey CFO', actorUserId: baseline.cfoUserId, reason: 'archive it' },
    );
    const artifact = await prisma.artifact.findUniqueOrThrow({ where: { id: result.artifactId } });
    const bytes = await import('node:fs/promises').then((fs) => fs.readFile(path.join(storageDir, artifact.uri), 'utf8'));
    const lines = bytes.trim().split('\n').slice(1);
    expect(lines[0]).toContain('Earlier');
    expect(lines[1]).toContain('Later');
  });

  it('throws for an unknown filing id', async () => {
    await expect(
      archiveRtdFiling(
        { prisma, storageDir },
        { rtdFilingId: 'not-a-real-id', cfoName: 'Casey CFO', actorUserId: baseline.cfoUserId, reason: 'x' },
      ),
    ).rejects.toThrow(RtdFilingNotFoundError);
  });

  it('refuses to re-archive an already-archived filing', async () => {
    const { stamped } = await stampOne();
    await archiveRtdFiling(
      { prisma, storageDir },
      { rtdFilingId: stamped.rtdFilingId, cfoName: 'Casey CFO', actorUserId: baseline.cfoUserId, reason: 'first archive' },
    );
    await expect(
      archiveRtdFiling(
        { prisma, storageDir },
        { rtdFilingId: stamped.rtdFilingId, cfoName: 'Casey CFO', actorUserId: baseline.cfoUserId, reason: 'second archive' },
      ),
    ).rejects.toThrow(RtdFilingAlreadyArchivedError);
  });

  it('refuses a non-INITIAL filing (DC1A_AMENDMENT belongs to ticket 2.4)', async () => {
    const amendment = await prisma.rtdFiling.create({ data: { name: '2026_RTD_8_DC1A_TEST', kind: 'DC1A_AMENDMENT' } });
    await expect(
      archiveRtdFiling(
        { prisma, storageDir },
        { rtdFilingId: amendment.id, cfoName: 'Casey CFO', actorUserId: baseline.cfoUserId, reason: 'x' },
      ),
    ).rejects.toThrow(UnsupportedFilingKindError);
  });
});
