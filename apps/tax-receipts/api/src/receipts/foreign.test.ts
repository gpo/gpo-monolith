import { describe, expect, it, beforeEach } from 'vitest';
import { setKillSwitch } from '../auth/kill-switch.js';
import { withChangeLog } from '../changelog/write.js';
import { ContributionNotFoundError } from '../contributions/metadata-write-through.js';
import { resetDb, seedBaseline, testPrisma } from '../test/db.js';
import {
  DuplicateForeignReceiptNumberError,
  ForeignReceiptNumberFormatError,
  recordForeignReceipt,
} from './foreign.js';
import { AllocationOverageError, MissingAddressError, ReceiptIssuanceValidationError } from './issue.js';

const prisma = testPrisma();

describe('recordForeignReceipt (ticket 3.8)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
  });

  async function seedContact(addresses: unknown[] = [
    { housenumber: '1', street: 'Main St', city: 'Toronto', state: 'ON', postalcode: 'M1M1M1', country: 'CA' },
  ]) {
    return prisma.contact.create({
      data: { qomonContactId: 1n, name: 'Dana Donor', addresses: addresses as never },
    });
  }

  async function seedContribution(contactId: string, amountCents = 5_000) {
    return prisma.contribution.create({
      data: {
        qomonTransactionId: 1n,
        contactId,
        amountCents,
        acceptedAt: new Date('2026-03-01T12:00:00Z'),
      },
    });
  }

  async function seedMetadata(contributionId: string, overrides: Record<string, unknown> = {}) {
    return withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contributionMetadata.create({
        data: { contributionId, periodId: baseline.periodId, entityKind: 'PARTY', receivedBy: 'GPO', ...overrides },
      });
      await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contributionId, after });
      return after;
    });
  }

  it('records a receipt with an operator-supplied number, no PDF, and no sequence movement', async () => {
    const contact = await seedContact();
    const contribution = await seedContribution(contact.id);
    await seedMetadata(contribution.id);

    const result = await recordForeignReceipt(
      { prisma },
      {
        contributionId: contribution.id,
        actorUserId: baseline.cfoUserId,
        reason: 'EO-stock book #4, slip 12 — event had no connectivity',
        receiptNumber: 'EOSTOCK-000412',
      },
    );

    expect(result.receiptNumber).toBe('EOSTOCK-000412');
    expect(result.amountCents).toBe(5_000);

    const receipt = await prisma.receipt.findUniqueOrThrow({
      where: { id: result.id },
      include: { allocations: true },
    });
    expect(receipt.numberSource).toBe('FOREIGN');
    expect(receipt.pdfArtifactId).toBeNull();
    expect(receipt.allocations).toHaveLength(1);
    expect(receipt.allocations[0]!.amountCents).toBe(5_000);

    const seq = await prisma.receiptSequence.findUniqueOrThrow({ where: { prefix: 'GPO-' } });
    expect(seq.counter).toBe(402_509); // untouched by a foreign recording

    const receiptLog = await prisma.changeLogEntry.findMany({
      where: { subjectType: 'Receipt', subjectId: result.id },
    });
    expect(receiptLog).toHaveLength(1);
    expect((receiptLog[0]!.after as { numberSource: string }).numberSource).toBe('FOREIGN');
  });

  it('rejects a number that looks like the tool\'s own GPO- sequence format', async () => {
    const contact = await seedContact();
    const contribution = await seedContribution(contact.id);
    await seedMetadata(contribution.id);

    await expect(
      recordForeignReceipt(
        { prisma },
        {
          contributionId: contribution.id,
          actorUserId: baseline.cfoUserId,
          reason: 'mistaken format',
          receiptNumber: 'GPO-00000001',
        },
      ),
    ).rejects.toBeInstanceOf(ForeignReceiptNumberFormatError);
  });

  it('rejects a duplicate receipt number', async () => {
    const contact = await seedContact();
    const first = await seedContribution(contact.id, 3_000);
    await seedMetadata(first.id);
    await recordForeignReceipt(
      { prisma },
      { contributionId: first.id, actorUserId: baseline.cfoUserId, reason: 'first', receiptNumber: 'EOSTOCK-1' },
    );

    const second = await prisma.contribution.create({
      data: { qomonTransactionId: 2n, contactId: contact.id, amountCents: 2_000, acceptedAt: new Date('2026-03-02T12:00:00Z') },
    });
    await seedMetadata(second.id);

    await expect(
      recordForeignReceipt(
        { prisma },
        { contributionId: second.id, actorUserId: baseline.cfoUserId, reason: 'dup', receiptNumber: 'EOSTOCK-1' },
      ),
    ).rejects.toBeInstanceOf(DuplicateForeignReceiptNumberError);
  });

  it('rejects an amount above what is still eligible (invariant 1)', async () => {
    const contact = await seedContact();
    const contribution = await seedContribution(contact.id);
    await seedMetadata(contribution.id, { nonDeductibleCents: 1_000 });

    await expect(
      recordForeignReceipt(
        { prisma },
        {
          contributionId: contribution.id,
          actorUserId: baseline.cfoUserId,
          reason: 'over-allocate',
          receiptNumber: 'EOSTOCK-2',
          amountCents: 4_500,
        },
      ),
    ).rejects.toBeInstanceOf(AllocationOverageError);
  });

  it('rejects issuance while the kill switch is engaged', async () => {
    await setKillSwitch(prisma, { userId: baseline.cfoUserId, reason: 'EO request' }, true);
    const contact = await seedContact();
    const contribution = await seedContribution(contact.id);
    await seedMetadata(contribution.id);

    await expect(
      recordForeignReceipt(
        { prisma },
        { contributionId: contribution.id, actorUserId: baseline.cfoUserId, reason: 'blocked', receiptNumber: 'EOSTOCK-3' },
      ),
    ).rejects.toThrow(/kill switch/);
  });

  it('rejects a contact with no address on file', async () => {
    const contact = await seedContact([]);
    const contribution = await seedContribution(contact.id);
    await seedMetadata(contribution.id);

    await expect(
      recordForeignReceipt(
        { prisma },
        { contributionId: contribution.id, actorUserId: baseline.cfoUserId, reason: 'no address', receiptNumber: 'EOSTOCK-4' },
      ),
    ).rejects.toBeInstanceOf(MissingAddressError);
  });

  it('rejects an unknown contribution', async () => {
    await expect(
      recordForeignReceipt(
        { prisma },
        { contributionId: 'does-not-exist', actorUserId: baseline.cfoUserId, reason: 'missing', receiptNumber: 'EOSTOCK-5' },
      ),
    ).rejects.toBeInstanceOf(ContributionNotFoundError);
  });

  it('rejects a contribution with no metadata yet', async () => {
    const contact = await seedContact();
    const contribution = await seedContribution(contact.id);

    await expect(
      recordForeignReceipt(
        { prisma },
        { contributionId: contribution.id, actorUserId: baseline.cfoUserId, reason: 'no metadata', receiptNumber: 'EOSTOCK-6' },
      ),
    ).rejects.toBeInstanceOf(ReceiptIssuanceValidationError);
  });

  it('honours an explicit issueDate for a receipt recorded well after the fact', async () => {
    const contact = await seedContact();
    const contribution = await seedContribution(contact.id);
    await seedMetadata(contribution.id);

    const result = await recordForeignReceipt(
      { prisma },
      {
        contributionId: contribution.id,
        actorUserId: baseline.cfoUserId,
        reason: 'recorded late',
        receiptNumber: 'EOSTOCK-7',
        issueDate: new Date('2026-02-14T18:00:00Z'),
      },
    );
    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: result.id } });
    expect(receipt.issueDate.toISOString()).toBe('2026-02-14T18:00:00.000Z');
  });
});
