import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import { getContributionDetail } from '../contributions/detail.js';
import { editContributionMetadata } from '../contributions/metadata-edit.js';
import { enterManualPayment, ManualEntryError } from '../payments/manual-entry.js';
import { issueReceipt } from '../receipts/issue.js';
import { generateAllReport } from '../reports/all-report.js';
import { generateS2p2Report } from '../reports/s2p2-report.js';
import { fixtureContact, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { runValidationForContribution } from '../validation/run.js';
import {
  createLeadershipContestant,
  LeadershipContestantError,
  receiptEntityLabel,
  updateLeadershipContestant,
} from './contestants.js';

const prisma = testPrisma();

describe('leadership contestants (EO evaluation rows 25, 26, 28)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let storageDir: string;
  let contactId: string;
  let ana: string;
  let ben: string;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-leadership-test-'));
    await prisma.riding.create({ data: { ridingNumber: 84, name: 'Parry Sound-Muskoka', qomonApiKey: 'x' } });
    contactId = (
      await fixtureContact(prisma, {
        data: {
          name: 'Dana Donor',
          firstName: 'Dana',
          lastName: 'Donor',
          addresses: [{ housenumber: '1', street: 'Main St', city: 'Toronto', state: 'ON', postalcode: 'M5V 2T6', country: 'CA' }],
        },
      })
    ).id;
    const actor = { actorUserId: baseline.adminUserId, reason: 'contest opened' };
    ana = (await createLeadershipContestant(prisma, { ...actor, name: 'Ana Leader', contestName: '2026 Leadership' })).id;
    ben = (await createLeadershipContestant(prisma, { ...actor, name: 'Ben Leader', contestName: '2026 Leadership' })).id;
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  const payment = (descriptive: Record<string, unknown>, amountCents = 25_000) => ({
    actorUserId: baseline.cfoUserId,
    reason: 'cheque received',
    contactId,
    amountCents,
    receivedAt: new Date('2026-04-10T15:00:00Z'),
    method: 'CHEQUE' as const,
    descriptive,
  });

  it('change-logs contestant writes, and the database refuses an unlogged one', async () => {
    await updateLeadershipContestant(prisma, { id: ben, active: false, actorUserId: baseline.adminUserId, reason: 'withdrew' });
    const entries = await prisma.changeLogEntry.findMany({
      where: { subjectType: 'LeadershipContestant', subjectId: ben },
      orderBy: { at: 'asc' },
    });
    expect(entries.map((e) => e.reason)).toEqual(['contest opened', 'withdrew']);
    expect(entries[1]!.before).toMatchObject({ active: true });
    expect(entries[1]!.after).toMatchObject({ active: false });

    await expect(prisma.leadershipContestant.create({ data: { name: 'X', contestName: 'Y' } })).rejects.toThrow();
  });

  it('records a LEADERSHIP contribution with its contestant, with no riding and no A2 finding', async () => {
    const { contribution } = await enterManualPayment(
      prisma,
      payment({ entity_kind: 'LEADERSHIP', leadership_contestant_id: ana, received_by: 'ENTITY' }),
    );
    expect(contribution).toMatchObject({ entityKind: 'LEADERSHIP', leadershipContestantId: ana, ridingNumber: null });
    const findings = await prisma.workItem.findMany({ where: { subjectId: contribution.id, ruleRef: 'A2' } });
    expect(findings).toHaveLength(0);

    const detail = await getContributionDetail(prisma, contribution.id, null);
    expect(detail?.metadata).toMatchObject({
      entityKind: 'LEADERSHIP',
      leadershipContestantName: 'Ana Leader',
      agencyContribution: false,
    });
  });

  it('rejects a leadership entry with no contestant, a riding, or a withdrawn contestant, writing nothing', async () => {
    await updateLeadershipContestant(prisma, { id: ben, active: false, actorUserId: baseline.adminUserId, reason: 'withdrew' });
    await expect(enterManualPayment(prisma, payment({ entity_kind: 'LEADERSHIP' }))).rejects.toBeInstanceOf(
      LeadershipContestantError,
    );
    await expect(
      enterManualPayment(prisma, payment({ entity_kind: 'LEADERSHIP', leadership_contestant_id: ana, riding_number: 84 })),
    ).rejects.toBeInstanceOf(ManualEntryError);
    await expect(
      enterManualPayment(prisma, payment({ entity_kind: 'LEADERSHIP', leadership_contestant_id: ben })),
    ).rejects.toThrow(/no longer an active leadership contestant/);
    await expect(
      enterManualPayment(prisma, payment({ entity_kind: 'PARTY', leadership_contestant_id: ana })),
    ).rejects.toThrow(/does not name a leadership contestant/);
    expect(await prisma.payment.count()).toBe(0);
  });

  it('keeps a withdrawn contestant on an edit that leaves them unchanged', async () => {
    const { contribution } = await enterManualPayment(
      prisma,
      payment({ entity_kind: 'LEADERSHIP', leadership_contestant_id: ben }),
    );
    await updateLeadershipContestant(prisma, { id: ben, active: false, actorUserId: baseline.adminUserId, reason: 'withdrew' });
    const updated = await editContributionMetadata(
      { prisma },
      {
        contributionId: contribution.id,
        actorUserId: baseline.cfoUserId,
        reason: 'source code fix',
        descriptive: {
          period_id: baseline.periodId,
          riding_number: null,
          entity_kind: 'LEADERSHIP',
          leadership_contestant_id: ben,
          received_by: 'GPO',
          goods_services: false,
          non_deductible_cents: 0,
          processed_date: null,
          source_code: 'LDR',
          eo_contributor_id: null,
          exception_reason: null,
          external_ref: null,
        },
      },
    );
    expect(updated).toMatchObject({ leadershipContestantId: ben, sourceCode: 'LDR' });
  });

  it('flags an imported-shape LEADERSHIP row with no contestant under rule A2', async () => {
    const { contribution } = await enterManualPayment(prisma, payment({ entity_kind: 'PARTY' }));
    // an import from Qomon arrives as LEADERSHIP with no contestant (Qomon has no field for one)
    await withChangeLog(prisma, { userId: null, reason: 'import' }, async (ctx) => {
      const after = await ctx.tx.contribution.update({ where: { id: contribution.id }, data: { entityKind: 'LEADERSHIP' } });
      await ctx.log({ subjectType: 'Contribution', subjectId: contribution.id, after });
    });
    await runValidationForContribution(prisma, contribution.id);
    const a2 = await prisma.workItem.findFirst({ where: { subjectId: contribution.id, ruleRef: 'A2', status: 'OPEN' } });
    expect(a2).not.toBeNull();
  });

  it('prints the contestant’s own name as the received-by label, whatever the operator typed', async () => {
    expect(
      await receiptEntityLabel(prisma, { entityKind: 'LEADERSHIP', leadershipContestantId: ana }, 'typed label'),
    ).toBe('Ana Leader');
    expect(await receiptEntityLabel(prisma, { entityKind: 'CA', leadershipContestantId: null }, 'typed label')).toBe(
      'typed label',
    );
  });

  it('files leadership receipts as LC with each contestant’s name, agency Y when GPO received it', async () => {
    const { contribution: toAna } = await enterManualPayment(
      prisma,
      payment({ entity_kind: 'LEADERSHIP', leadership_contestant_id: ana, received_by: 'GPO' }),
    );
    const { contribution: toBen } = await enterManualPayment(
      prisma,
      payment({ entity_kind: 'LEADERSHIP', leadership_contestant_id: ben, received_by: 'ENTITY' }, 10_000),
    );
    for (const c of [toAna, toBen]) {
      await issueReceipt(
        { prisma, storageDir },
        { contributionId: c.id, actorUserId: baseline.cfoUserId, reason: 'issue', politicalEntityLabel: 'ignored' },
      );
    }

    const all = await generateAllReport(
      { prisma, storageDir },
      {
        periodId: baseline.periodId,
        entityKind: 'LEADERSHIP',
        ridingNumber: null,
        actorUserId: baseline.cfoUserId,
        reason: 'report',
        politicalEntityLabel: () => 'ignored',
      },
    );
    const lines = all.csv.trim().split(/\r?\n/).slice(1);
    expect(lines).toHaveLength(2);
    // Agency_Contribution is column E, Political_Entity_Type G, Political_Entity H
    const cols = lines.map((l) => l.split(','));
    expect(cols.map((c) => [c[4], c[6], c[7]])).toEqual([
      ['Y', 'LC', 'Ana Leader'],
      ['N', 'LC', 'Ben Leader'],
    ]);

    // S2P2: the same donor's gifts to two contestants are two entities, not one $350 aggregate
    const s2p2 = await generateS2p2Report(
      { prisma, storageDir },
      {
        periodId: baseline.periodId,
        entityKind: 'LEADERSHIP',
        ridingNumber: null,
        actorUserId: baseline.cfoUserId,
        reason: 'report',
        politicalEntityLabel: () => 'ignored',
      },
    );
    expect(s2p2.rowCount).toBe(1);
    expect(s2p2.csv).toContain('LC,Ana Leader');
  });

  it('shows a split payment’s contributions, each with its own entity, amount, and agency flag', async () => {
    const { contribution } = await enterManualPayment(prisma, {
      ...payment({}, 50_000),
      contributions: [
        { amountCents: 30_000, descriptive: { entity_kind: 'PARTY', received_by: 'GPO' } },
        { amountCents: 20_000, descriptive: { entity_kind: 'CA', riding_number: 84, received_by: 'GPO' } },
      ],
    });
    const detail = await getContributionDetail(prisma, contribution.id, null);
    expect(detail?.payment.contributions.map((c) => [c.amountCents, c.entityKind, c.ridingNumber, c.agencyContribution])).toEqual([
      [30_000, 'PARTY', null, false],
      [20_000, 'CA', 84, true],
    ]);
  });
});
