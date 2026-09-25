import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import { issueReceipt } from '../receipts/issue.js';
import { buildRtdDraft } from '../rtd/draft.js';
import { markRtdFilingSent } from '../rtd/mark-sent.js';
import { prepareRtdFiling } from '../rtd/prepare.js';
import { createTestContribution, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { moveContributions } from './actions.js';
import { CorrectionValidationError, applyCorrection, previewCorrection } from './contribution-correction.js';
import { ContactNotMergedError, mergeContacts, unmergeContact } from './merge-contacts.js';

const prisma = testPrisma();
const ADDRESS = [{ housenumber: '1', street: 'Main St', city: 'Toronto', state: 'ON', postalcode: 'M1M1M1', country: 'CA' }];

describe('correction action 10: merge duplicate contacts', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let storageDir: string;
  let nextTx: bigint;
  let nextContact: bigint;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-merge-test-'));
    nextTx = 1n;
    nextContact = 1n;
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  const deps = () => ({ prisma, storageDir });
  const common = () => ({
    actorUserId: baseline.cfoUserId,
    reason: 'same person, Valerie T. and Val T.',
    politicalEntityLabel: 'Green Party of Ontario',
  });

  const seedContact = (name: string) =>
    prisma.contact.create({ data: { qomonContactId: nextContact++, name, addresses: ADDRESS, email: 'val@example.org' } });

  async function seedContribution(contactId: string, amountCents: number, receipted = false) {
    const c = await createTestContribution(prisma, {
      qomonTransactionId: nextTx++,
      contactId,
      amountCents,
      acceptedAt: new Date('2026-03-01T12:00:00Z'),
    });
    await withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contribution.update({
        where: { id: c.id },
        data: { periodId: baseline.periodId, entityKind: 'PARTY', receivedBy: 'GPO' },
      });
      await ctx.log({ subjectType: 'Contribution', subjectId: c.id, after });
    });
    const receiptId = receipted
      ? (
          await issueReceipt(deps(), {
            contributionId: c.id,
            actorUserId: baseline.cfoUserId,
            reason: 'issue',
            politicalEntityLabel: 'Green Party of Ontario',
          })
        ).id
      : null;
    return { contribution: c, receiptId };
  }

  it('moves the duplicate\'s contributions onto the survivor, reissues receipts, re-points payments, and flags the duplicate', async () => {
    const survivor = await seedContact('Valerie T.');
    const duplicate = await seedContact('Val T.');
    const receipted = await seedContribution(duplicate.id, 10_000, true);
    const plain = await seedContribution(duplicate.id, 5_000);

    const input = await mergeContacts(prisma, { ...common(), survivorId: survivor.id, mergedAwayId: duplicate.id });
    const plan = await previewCorrection(prisma, input);
    expect(plan.changes).toHaveLength(2);
    expect(plan.cancelReceipts).toHaveLength(1);
    expect(plan.issueReceipts.map((r) => r.contactName)).toEqual(['Valerie T.']);
    expect(plan.followUps.some((f) => f.includes('merge Val T. into Valerie T.'))).toBe(true);

    const result = await applyCorrection(deps(), input);

    expect(result.supersededContributionIds.sort()).toEqual([receipted.contribution.id, plain.contribution.id].sort());
    const moved = await prisma.contribution.findMany({ where: { supersedesId: { not: null } } });
    expect(moved.every((c) => c.contactId === survivor.id && c.status === 'ACTIVE')).toBe(true);
    expect((await prisma.receipt.findUniqueOrThrow({ where: { id: receipted.receiptId! } })).status).toBe('CANCELLED');
    expect(result.issuedReceipts).toHaveLength(1);
    expect(result.issuedReceipts[0]).toMatchObject({ contactId: survivor.id, amountCents: 10_000 });

    const payments = await prisma.payment.findMany();
    expect(payments.every((p) => p.contactId === survivor.id)).toBe(true);
    const flagged = await prisma.contact.findUniqueOrThrow({ where: { id: duplicate.id } });
    expect(flagged.mergedIntoId).toBe(survivor.id);
    expect(flagged.mergedAt).not.toBeNull();

    const log = await prisma.changeLogEntry.findFirstOrThrow({
      where: { subjectType: 'Contact', subjectId: duplicate.id, correlationId: result.correlationId },
    });
    expect(log.reason).toBe('same person, Valerie T. and Val T.');
  });

  it('merges a contact that has no contributions: only the flag changes', async () => {
    const survivor = await seedContact('Valerie T.');
    const duplicate = await seedContact('Val T.');
    const result = await applyCorrection(deps(), await mergeContacts(prisma, { ...common(), survivorId: survivor.id, mergedAwayId: duplicate.id }));
    expect(result.createdContributionIds).toEqual([]);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: duplicate.id } })).mergedIntoId).toBe(survivor.id);
  });

  it('needs evidence when an RTD-reported contribution moves, stores it, and queues the DC-1A', async () => {
    const survivor = await seedContact('Valerie T.');
    const duplicate = await seedContact('Val T.');
    const { contribution } = await seedContribution(duplicate.id, 25_000);
    const prepared = await prepareRtdFiling(deps(), {
      year: 2026,
      contributionIds: [contribution.id],
      actorUserId: baseline.cfoUserId,
      reason: 'file',
      cfoName: 'Casey CFO',
    });
    await markRtdFilingSent(prisma, { rtdFilingId: prepared.rtdFilingId, actorUserId: baseline.cfoUserId, reason: 'sent' });

    await expect(
      mergeContacts(prisma, { ...common(), survivorId: survivor.id, mergedAwayId: duplicate.id }),
    ).rejects.toBeInstanceOf(CorrectionValidationError);

    const input = await mergeContacts(prisma, {
      ...common(),
      survivorId: survivor.id,
      mergedAwayId: duplicate.id,
      evidence: 'same email and phone; donor confirmed by phone on 2026-09-24',
    });
    const result = await applyCorrection(deps(), input);

    const owed = await prisma.workItem.findMany({ where: { kind: 'OWED_TO_EO', ruleRef: 'corrections-11' } });
    expect(owed.map((w) => w.subjectId)).toEqual([contribution.id]);
    expect(result.owedToEoWorkItemIds).toHaveLength(1);
    const log = await prisma.changeLogEntry.findFirstOrThrow({ where: { subjectType: 'Contact', subjectId: duplicate.id } });
    expect(JSON.stringify(log.after)).toContain('donor confirmed by phone');
  });

  it('the merged contributor\'s combined year crosses the RTD threshold, so the late records enter the next filing', async () => {
    const survivor = await seedContact('Valerie T.');
    const duplicate = await seedContact('Val T.');
    await seedContribution(survivor.id, 15_000);
    await seedContribution(duplicate.id, 15_000);
    expect((await buildRtdDraft(prisma, { year: 2026 })).rows).toHaveLength(0); // $150 each, under $200 apart

    await applyCorrection(deps(), await mergeContacts(prisma, { ...common(), survivorId: survivor.id, mergedAwayId: duplicate.id }));

    const draft = await buildRtdDraft(prisma, { year: 2026 });
    expect(draft.rows.length).toBeGreaterThan(0);
    expect(new Set(draft.rows.map((r) => r.contactId))).toEqual(new Set([survivor.id]));
  });

  it('refuses nonsense merges: itself, an already-merged contact, into a merged contact', async () => {
    const a = await seedContact('A');
    const b = await seedContact('B');
    const c = await seedContact('C');
    await expect(mergeContacts(prisma, { ...common(), survivorId: a.id, mergedAwayId: a.id })).rejects.toBeInstanceOf(CorrectionValidationError);
    await applyCorrection(deps(), await mergeContacts(prisma, { ...common(), survivorId: a.id, mergedAwayId: b.id }));
    await expect(mergeContacts(prisma, { ...common(), survivorId: c.id, mergedAwayId: b.id })).rejects.toBeInstanceOf(CorrectionValidationError);
    await expect(mergeContacts(prisma, { ...common(), survivorId: b.id, mergedAwayId: c.id })).rejects.toBeInstanceOf(CorrectionValidationError);
  });

  it('refuses to attribute anything to a merged contact afterwards', async () => {
    const survivor = await seedContact('Valerie T.');
    const duplicate = await seedContact('Val T.');
    const other = await seedContact('Other Donor');
    await applyCorrection(deps(), await mergeContacts(prisma, { ...common(), survivorId: survivor.id, mergedAwayId: duplicate.id }));
    const { contribution } = await seedContribution(other.id, 1_000);

    const move = await moveContributions(prisma, { ...common(), contributionIds: [contribution.id], toContactId: duplicate.id });
    await expect(applyCorrection(deps(), move)).rejects.toBeInstanceOf(CorrectionValidationError);
  });

  it('unmerging clears the flag and leaves the moved contributions where they are', async () => {
    const survivor = await seedContact('Valerie T.');
    const duplicate = await seedContact('Val T.');
    await seedContribution(duplicate.id, 3_000);
    await applyCorrection(deps(), await mergeContacts(prisma, { ...common(), survivorId: survivor.id, mergedAwayId: duplicate.id }));

    await unmergeContact(prisma, { contactId: duplicate.id, actorUserId: baseline.cfoUserId, reason: 'they are two people' });

    const after = await prisma.contact.findUniqueOrThrow({ where: { id: duplicate.id } });
    expect(after.mergedIntoId).toBeNull();
    const active = await prisma.contribution.findMany({ where: { status: 'ACTIVE' } });
    expect(active.map((c) => c.contactId)).toEqual([survivor.id]);
    await expect(
      unmergeContact(prisma, { contactId: duplicate.id, actorUserId: baseline.cfoUserId, reason: 'again' }),
    ).rejects.toBeInstanceOf(ContactNotMergedError);
  });
});
