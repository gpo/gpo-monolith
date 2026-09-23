import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { standardOntarioEsaHolidays } from '@gpo/tax-receipts-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import { makeContribution, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { buildRtdDraft } from './draft.js';
import { prepareRtdFiling } from './prepare.js';

const prisma = testPrisma();

/**
 * The December-straddle case (ticket 2.7, test-plan.md §2 item 7,
 * research/deep-review-2.md finding 3): a deposit accepted 2026-12-22 is
 * due mid-January 2027 and must be filed as a **2026** filing (2026
 * filename, 2026 period id, 2026 aggregate reconciled against whatever
 * gpo_report already filed pre-cutover) in the same run week the tool's
 * 2027 aggregates start at zero.
 *
 * This suite found nothing left to BUILD: ticket 2.2's per-(contact,
 * calendar-year) grouping already resets the aggregate at the year
 * boundary (covered on its own in draft.test.ts), ticket 2.3's
 * `buildRtdFilingName` already separates the disclosure year from the
 * submission instant's year (covered in stamp.test.ts), and periodId is
 * fixed at intake (rule A1, ticket 1.6) independent of when a filing is
 * built. What was genuinely unverified is that all three compose correctly
 * end to end across a real Dec/Jan boundary, with a PRE-EXISTING
 * "legacy-reported" row in the mix (standing in for what ticket 1.17's
 * CiviCRM import will eventually seed as historical RtdInclusion rows) --
 * that composition is what this file actually tests.
 *
 * Residual, explicitly out of this ticket's scope: ticket 1.17 (the real
 * CiviCRM historical import, still blocked on C1/C2) must itself write
 * `RtdInclusion` rows for whatever `gpo_report` already filed before
 * cutover, not just `Contribution`/`ContributionMetadata` rows -- only
 * then does "reconciled against imported RtdInclusion rows"
 * (deep-review-2.md finding 3) hold for real 2026 history. The rollout
 * runbook's "gpo_report files everything due through the Jan 3 freeze"
 * pre-window step is operational, not code.
 */
describe('December-straddle case (ticket 2.7)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let storageDir: string;
  let nextContactId: bigint;
  let nextTxId: bigint;

  const PERIOD_2027 = 68;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma); // period 67 = 2026 Annual, ET-aligned
    await prisma.period.create({
      data: {
        id: PERIOD_2027,
        name: '2027 Annual',
        kind: 'ANNUAL',
        startsAt: new Date('2027-01-01T05:00:00Z'),
        endsAt: new Date('2028-01-01T05:00:00Z'),
      },
    });
    await prisma.businessDayCalendar.create({
      data: { year: 2027, holidays: standardOntarioEsaHolidays(2027) },
    });
    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-rtd-straddle-test-'));
    nextContactId = 1n;
    nextTxId = 1n;
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  async function seedMetadata(contributionId: string, periodId: number) {
    return withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contributionMetadata.create({
        data: {
          contributionId,
          periodId,
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

  async function seedContribution(opts: {
    contactId?: string;
    amountCents: number;
    acceptedAt: Date;
    periodId: number;
    lastName?: string;
    firstName?: string;
  }) {
    if (opts.contactId) {
      const contribution = await prisma.contribution.create({
        data: {
          qomonTransactionId: nextTxId++,
          contactId: opts.contactId,
          amountCents: opts.amountCents,
          acceptedAt: opts.acceptedAt,
        },
      });
      await seedMetadata(contribution.id, opts.periodId);
      return { contactId: opts.contactId, contributionId: contribution.id };
    }
    const made = await makeContribution(prisma, {
      qomonContactId: nextContactId++,
      qomonTransactionId: nextTxId++,
      amountCents: opts.amountCents,
      acceptedAt: opts.acceptedAt,
      contactFirstName: opts.firstName ?? 'Dana',
      contactLastName: opts.lastName ?? 'Donor',
    });
    await seedMetadata(made.contributionId, opts.periodId);
    return made;
  }

  it('files a late-December 2026 deposit as a 2026 filing, submitted in January 2027, reconciled against an already-reported 2026 row', async () => {
    // Stand-in for what ticket 1.17 will eventually import: a 2026 deposit
    // gpo_report already filed pre-cutover, crossing the $200 aggregate on
    // its own.
    const legacyReported = await seedContribution({
      amountCents: 25_000,
      acceptedAt: new Date('2026-06-01T12:00:00Z'),
      periodId: baseline.periodId,
    });
    const legacyFiling = await prisma.rtdFiling.create({
      data: { name: '2026_RTD_8_060520261200', submittedAt: new Date('2026-06-05T12:00:00Z'), submittedBy: baseline.cfoUserId },
    });
    await prisma.rtdInclusion.create({
      data: {
        contributionId: legacyReported.contributionId,
        rtdFilingId: legacyFiling.id,
        amountCents: 25_000,
        aggregateAfterCents: 25_000,
      },
    });

    // The residual unreported 2026 deposit: synced live, late December,
    // same contact as the legacy-reported row.
    const decemberDeposit = await seedContribution({
      contactId: legacyReported.contactId,
      amountCents: 5_000,
      acceptedAt: new Date('2026-12-22T15:00:00Z'),
      periodId: baseline.periodId,
    });

    // The tool's first live run for 2026, well into the new year. Dec 22,
    // 2026 is a Tuesday; 15 ET business days later (skipping the Dec 25/26
    // and Jan 1 holidays plus weekends) is Thursday 2027-01-14 -- so by
    // Jan 20 this residual row is already overdue, the exact risk
    // deep-review-2.md finding 3 flags.
    const asOf = new Date('2027-01-20T15:00:00Z');
    const draft = await buildRtdDraft(prisma, { year: 2026, asOf });

    expect(draft.rows).toHaveLength(1);
    const row = draft.rows[0]!;
    expect(row.contributionId).toBe(decemberDeposit.contributionId);
    // Aggregate reconciles against the already-reported row: 250.00 + 50.00.
    expect(row.aggregateAfterCents).toBe(30_000);
    expect(row.periodId).toBe(baseline.periodId);
    expect(row.contributionYear).toBe(2026);
    // The clock spans the year boundary correctly (needs both the 2026 and
    // 2027 BusinessDayCalendar rows, both seeded above).
    expect(row.dueDate).toBe('2027-01-14');
    expect(row.overdue).toBe(true);
    expect(row.businessDaysRemaining).toBeLessThan(0);

    const prepared = await prepareRtdFiling(
      { prisma, storageDir },
      {
        year: 2026,
        contributionIds: [decemberDeposit.contributionId],
        actorUserId: baseline.cfoUserId,
        reason: 'residual 2026 filing, submitted post-cutover',
        cfoName: 'Casey CFO',
        asOf,
      },
    );
    // 2026 filename despite a January 2027 submission timestamp.
    expect(prepared.filingName).toBe('2026_RTD_8_012020271000');

    const artifact = await prisma.artifact.findUniqueOrThrow({ where: { id: prepared.artifactId } });
    const text = await readFile(path.join(storageDir, artifact.uri), 'utf8');
    const dataLine = text.trim().split('\n')[1]!;
    expect(dataLine).toContain(',2026,'); // Contribution Year
    expect(dataLine).toContain('12222026'); // Deposit Date
    expect(dataLine).toContain('50.00'); // this row's own amount
    expect(dataLine).toContain('300.00'); // reconciled aggregate
  });

  it('starts 2027 aggregates at zero in the same run week, for the same contact', async () => {
    const legacyReported = await seedContribution({
      amountCents: 25_000,
      acceptedAt: new Date('2026-06-01T12:00:00Z'),
      periodId: baseline.periodId,
    });
    await prisma.rtdInclusion.create({
      data: {
        contributionId: legacyReported.contributionId,
        rtdFilingId: (
          await prisma.rtdFiling.create({
            data: { name: '2026_RTD_8_060520261200', submittedAt: new Date('2026-06-05T12:00:00Z'), submittedBy: baseline.cfoUserId },
          })
        ).id,
        amountCents: 25_000,
        aggregateAfterCents: 25_000,
      },
    });
    const januaryDeposit = await seedContribution({
      contactId: legacyReported.contactId,
      amountCents: 21_000,
      acceptedAt: new Date('2027-01-08T15:00:00Z'),
      periodId: PERIOD_2027,
    });

    const asOf = new Date('2027-01-20T15:00:00Z'); // same run week as the other test's residual 2026 filing
    const draft2027 = await buildRtdDraft(prisma, { year: 2027, asOf });

    expect(draft2027.rows).toHaveLength(1);
    expect(draft2027.rows[0]!.contributionId).toBe(januaryDeposit.contributionId);
    // Starts at zero: does NOT carry the 2026 aggregate forward.
    expect(draft2027.rows[0]!.aggregateAfterCents).toBe(21_000);
    expect(draft2027.rows[0]!.contributionYear).toBe(2027);
  });
});
