import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import type { Prisma } from '../generated/prisma/index.js';
import { resetDb, seedBaseline, testPrisma, createTestContribution } from '../test/db.js';
import {
  SpaceIssuanceBlockedError,
  getSpaceIssuanceGate,
  issueReceiptsForSpace,
  previewSpaceIssuance,
} from './issuance.js';

const prisma = testPrisma();

describe('per-space issuance (ticket 3.12, first slice)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let storageDir: string;
  let nextTransactionId: number;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-space-issuance-test-'));
    nextTransactionId = 1;
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  const SPACE = { periodId: 67, ridingNumber: null, entityKind: 'PARTY' as const };

  async function seedContribution(
    name: string,
    amountCents = 5_000,
    overrides: Record<string, unknown> = {},
  ) {
    const contact = await prisma.contact.create({
      data: {
        qomonContactId: BigInt(nextTransactionId),
        name,
        addresses: [
          { housenumber: '1', street: 'Main St', city: 'Toronto', state: 'ON', postalcode: 'M1M1M1', country: 'CA' },
        ] as Prisma.InputJsonValue,
      },
    });
    const contribution = await createTestContribution(prisma, {
        qomonTransactionId: BigInt(nextTransactionId++),
        contactId: contact.id,
        amountCents,
        acceptedAt: new Date('2026-03-01T12:00:00Z'),
      });
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contribution.update({ where: { id: contribution.id }, data: {
          periodId: SPACE.periodId,
          ridingNumber: SPACE.ridingNumber,
          entityKind: SPACE.entityKind,
          receivedBy: 'GPO',
          ...overrides,
        } });
      await ctx.log({ subjectType: 'Contribution', subjectId: contribution.id, after });
    });
    return { contactId: contact.id, contributionId: contribution.id };
  }

  it('previews every still-eligible contribution in the space, unblocked', async () => {
    const a = await seedContribution('Dana Donor', 5_000);
    const b = await seedContribution('Sam Supporter', 3_000);

    const preview = await previewSpaceIssuance(prisma, SPACE);
    expect(preview.blocked).toBe(false);
    expect(preview.blockers).toHaveLength(0);
    expect(preview.lines.map((l) => l.contributionId).sort()).toEqual(
      [a.contributionId, b.contributionId].sort(),
    );
    expect(preview.totals).toEqual({ receiptCount: 2, amountCents: 8_000, emailCount: 0, mailCount: 2 });
  });

  it('excludes a contribution outside the space and one already fully receipted', async () => {
    const inSpace = await seedContribution('Dana Donor', 5_000);
    // a different riding/entity: not this space
    await seedContribution('Other Riding', 4_000, { ridingNumber: 12, entityKind: 'CA' });

    await issueReceiptsForSpace(
      { prisma, storageDir },
      {
        ...SPACE,
        actorUserId: baseline.cfoUserId,
        reason: 'first pass',
        politicalEntityLabel: 'Green Party of Ontario',
      },
    );

    const preview = await previewSpaceIssuance(prisma, SPACE);
    expect(preview.lines.find((l) => l.contributionId === inSpace.contributionId)).toBeUndefined();
    expect(preview.totals.receiptCount).toBe(0);
  });

  it('blocks the whole space when any of its contributions has an open work item', async () => {
    await seedContribution('Dana Donor', 5_000);
    const flagged = await seedContribution('Sam Supporter', 3_000);
    await prisma.workItem.create({
      data: {
        kind: 'VALIDATION',
        subjectType: 'Contribution',
        subjectId: flagged.contributionId,
        contactId: flagged.contactId,
        ruleRef: 'B2',
      },
    });

    const gate = await getSpaceIssuanceGate(prisma, SPACE);
    expect(gate).toHaveLength(1);
    expect(gate[0]!.contributionId).toBe(flagged.contributionId);

    const preview = await previewSpaceIssuance(prisma, SPACE);
    expect(preview.blocked).toBe(true);
    expect(preview.lines).toHaveLength(0); // nothing previewed, incl. the clean contribution

    await expect(
      issueReceiptsForSpace(
        { prisma, storageDir },
        {
          ...SPACE,
          actorUserId: baseline.cfoUserId,
          reason: 'should not run',
          politicalEntityLabel: 'Green Party of Ontario',
        },
      ),
    ).rejects.toThrow(SpaceIssuanceBlockedError);

    const receiptCount = await prisma.receipt.count();
    expect(receiptCount).toBe(0);
  });

  it('generates one receipt per eligible contribution, repeatable for stragglers', async () => {
    const a = await seedContribution('Dana Donor', 5_000);
    const b = await seedContribution('Sam Supporter', 3_000);

    const first = await issueReceiptsForSpace(
      { prisma, storageDir },
      {
        ...SPACE,
        actorUserId: baseline.cfoUserId,
        reason: 'space issuance',
        politicalEntityLabel: 'Green Party of Ontario',
      },
    );
    expect(first.succeeded).toBe(2);
    expect(first.failed).toBe(0);
    expect(first.results.map((r) => r.contributionId).sort()).toEqual(
      [a.contributionId, b.contributionId].sort(),
    );

    const receiptCount = await prisma.receipt.count();
    expect(receiptCount).toBe(2);

    // a straggler arrives after the first run
    const straggler = await seedContribution('Late Larry', 1_000);
    const second = await issueReceiptsForSpace(
      { prisma, storageDir },
      {
        ...SPACE,
        actorUserId: baseline.cfoUserId,
        reason: 'straggler follow-up',
        politicalEntityLabel: 'Green Party of Ontario',
      },
    );
    expect(second.succeeded).toBe(1);
    expect(second.results[0]!.contributionId).toBe(straggler.contributionId);
    expect(await prisma.receipt.count()).toBe(3);
  });

  it('keeps going past a per-row failure (missing address) and reports it', async () => {
    const good = await seedContribution('Dana Donor', 5_000);
    const noAddress = await prisma.contact.create({
      data: { qomonContactId: BigInt(nextTransactionId), name: 'No Address Ned' },
    });
    const badContribution = await createTestContribution(prisma, {
        qomonTransactionId: BigInt(nextTransactionId++),
        contactId: noAddress.id,
        amountCents: 2_000,
        acceptedAt: new Date('2026-03-01T12:00:00Z'),
      });
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contribution.update({ where: { id: badContribution.id }, data: {
          periodId: SPACE.periodId,
          ridingNumber: SPACE.ridingNumber,
          entityKind: SPACE.entityKind,
          receivedBy: 'GPO',
        } });
      await ctx.log({ subjectType: 'Contribution', subjectId: badContribution.id, after });
    });

    const result = await issueReceiptsForSpace(
      { prisma, storageDir },
      {
        ...SPACE,
        actorUserId: baseline.cfoUserId,
        reason: 'partial batch',
        politicalEntityLabel: 'Green Party of Ontario',
      },
    );
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    const failedRow = result.results.find((r) => r.contributionId === badContribution.id)!;
    expect(failedRow.ok).toBe(false);
    expect(failedRow.error).toMatch(/address/);
    const okRow = result.results.find((r) => r.contributionId === good.contributionId)!;
    expect(okRow.ok).toBe(true);
    expect(okRow.receiptNumber).toBeDefined();
  });
});
