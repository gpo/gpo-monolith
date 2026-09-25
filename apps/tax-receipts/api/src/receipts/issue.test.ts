import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setKillSwitch } from '../auth/kill-switch.js';
import { withChangeLog } from '../changelog/write.js';
import { ContributionNotFoundError } from '../contributions/metadata-edit.js';
import type { Prisma } from '../generated/prisma/index.js';
import { resetDb, seedBaseline, testPrisma, createTestContribution } from '../test/db.js';
import {
  AllocationOverageError,
  MissingAddressError,
  ReceiptIssuanceValidationError,
  issueReceipt,
} from './issue.js';

const prisma = testPrisma();

describe('receipt issuance (ticket 3.1)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;
  let storageDir: string;
  let nextTransactionId: number;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
    storageDir = await mkdtemp(path.join(tmpdir(), 'gpo-receipts-test-'));
    nextTransactionId = 1;
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  async function seedContact(addresses: unknown[] = [
    { housenumber: '1', street: 'Main St', city: 'Toronto', state: 'ON', postalcode: 'M1M1M1', country: 'CA' },
  ]) {
    return prisma.contact.create({
      data: { qomonContactId: 1n, name: 'Dana Donor', addresses: addresses as Prisma.InputJsonValue },
    });
  }

  async function seedContribution(contactId: string, amountCents = 5_000) {
    return createTestContribution(prisma, {
        qomonTransactionId: BigInt(nextTransactionId++),
        contactId,
        amountCents,
        acceptedAt: new Date('2026-03-01T12:00:00Z'),
      });
  }

  async function seedMetadata(contributionId: string, overrides: Record<string, unknown> = {}) {
    return withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contribution.update({ where: { id: contributionId }, data: {
          periodId: baseline.periodId,
          entityKind: 'PARTY',
          receivedBy: 'GPO',
          ...overrides,
        } });
      await ctx.log({ subjectType: 'Contribution', subjectId: contributionId, after });
      return after;
    });
  }

  it('issues a receipt, reserves a sequence number, and renders a one-page PDF artifact', async () => {
    const contact = await seedContact();
    const contribution = await seedContribution(contact.id);
    await seedMetadata(contribution.id);

    const result = await issueReceipt(
      { prisma, storageDir },
      {
        contributionId: contribution.id,
        actorUserId: baseline.cfoUserId,
        reason: 'issue test receipt',
        politicalEntityLabel: 'Green Party of Ontario',
      },
    );

    expect(result.receiptNumber).toBe('GPO-00402510');
    expect(result.amountCents).toBe(5_000);

    const receipt = await prisma.receipt.findUniqueOrThrow({
      where: { id: result.id },
      include: { pdfArtifact: true, allocations: true },
    });
    expect(receipt.pdfArtifactId).toBe(result.pdfArtifactId);
    expect(receipt.allocations).toHaveLength(1);
    expect(receipt.allocations[0]!.amountCents).toBe(5_000);
    expect(receipt.pdfArtifact).not.toBeNull();

    const bytes = await readFile(path.join(storageDir, receipt.pdfArtifact!.uri));
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);

    const seq = await prisma.receiptSequence.findUniqueOrThrow({ where: { prefix: 'GPO-' } });
    expect(seq.counter).toBe(402_510);

    const receiptLog = await prisma.changeLogEntry.findMany({
      where: { subjectType: 'Receipt', subjectId: result.id },
    });
    expect(receiptLog.length).toBeGreaterThanOrEqual(2); // create + pdfArtifactId link

    // The AddressSnapshot and ReceiptAllocation writes each get their own
    // entry too — the audit trail should show exactly what address was
    // printed and how the amount was allocated, not just that a receipt
    // with some receiptNumber came into being.
    const snapshotLog = await prisma.changeLogEntry.findFirst({
      where: { subjectType: 'AddressSnapshot', subjectId: receipt.addressSnapshotId },
    });
    expect(snapshotLog).not.toBeNull();
    expect((snapshotLog!.after as { city: string }).city).toBe('Toronto');

    const allocationRow = await prisma.receiptAllocation.findFirstOrThrow({
      where: { receiptId: result.id },
    });
    const allocationLog = await prisma.changeLogEntry.findFirst({
      where: { subjectType: 'ReceiptAllocation', subjectId: allocationRow.id },
    });
    expect(allocationLog).not.toBeNull();
  });

  it('rejects issuance while the kill switch is engaged', async () => {
    await setKillSwitch(prisma, { userId: baseline.cfoUserId, reason: 'EO request' }, true);
    const contact = await seedContact();
    const contribution = await seedContribution(contact.id);
    await seedMetadata(contribution.id);

    await expect(
      issueReceipt(
        { prisma, storageDir },
        {
          contributionId: contribution.id,
          actorUserId: baseline.cfoUserId,
          reason: 'blocked',
          politicalEntityLabel: 'Green Party of Ontario',
        },
      ),
    ).rejects.toThrow(/kill switch/);
  });

  it('rejects an amount above what is still eligible (invariant 1)', async () => {
    const contact = await seedContact();
    const contribution = await seedContribution(contact.id);
    await seedMetadata(contribution.id, { nonDeductibleCents: 1_000 });

    await expect(
      issueReceipt(
        { prisma, storageDir },
        {
          contributionId: contribution.id,
          actorUserId: baseline.cfoUserId,
          reason: 'over-allocate',
          amountCents: 4_500,
          politicalEntityLabel: 'Green Party of Ontario',
        },
      ),
    ).rejects.toBeInstanceOf(AllocationOverageError);
  });

  it('a second receipt against the same contribution is limited to what remains', async () => {
    const contact = await seedContact();
    const contribution = await seedContribution(contact.id, 10_000);
    await seedMetadata(contribution.id);

    await issueReceipt(
      { prisma, storageDir },
      {
        contributionId: contribution.id,
        actorUserId: baseline.cfoUserId,
        reason: 'first receipt',
        amountCents: 6_000,
        politicalEntityLabel: 'Green Party of Ontario',
      },
    );

    await expect(
      issueReceipt(
        { prisma, storageDir },
        {
          contributionId: contribution.id,
          actorUserId: baseline.cfoUserId,
          reason: 'second receipt, too big',
          amountCents: 5_000,
          politicalEntityLabel: 'Green Party of Ontario',
        },
      ),
    ).rejects.toBeInstanceOf(AllocationOverageError);

    const second = await issueReceipt(
      { prisma, storageDir },
      {
        contributionId: contribution.id,
        actorUserId: baseline.cfoUserId,
        reason: 'second receipt, fits',
        amountCents: 4_000,
        politicalEntityLabel: 'Green Party of Ontario',
      },
    );
    expect(second.amountCents).toBe(4_000);
  });

  it('rejects a contact with no address on file, naming the donor and what is missing', async () => {
    const contact = await seedContact([]);
    const contribution = await seedContribution(contact.id);
    await seedMetadata(contribution.id);

    const err: unknown = await issueReceipt(
      { prisma, storageDir },
      {
        contributionId: contribution.id,
        actorUserId: baseline.cfoUserId,
        reason: 'no address',
        politicalEntityLabel: 'Green Party of Ontario',
      },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(MissingAddressError);
    const message = (err as Error).message;
    expect(message).toContain('Dana Donor');
    expect(message).toContain('Qomon contact 1');
    expect(message).toContain('a street');
    expect(message).toContain('a city');
    expect(message).toContain('a postal code');
  });

  it('rejects an address missing only a street (real-world case: geocoded, no street on file)', async () => {
    const contact = await seedContact([{ city: 'Waterloo', state: 'ON', postalcode: 'N2L6H5', country: 'CA' }]);
    const contribution = await seedContribution(contact.id);
    await seedMetadata(contribution.id);

    const err: unknown = await issueReceipt(
      { prisma, storageDir },
      {
        contributionId: contribution.id,
        actorUserId: baseline.cfoUserId,
        reason: 'no street',
        politicalEntityLabel: 'Green Party of Ontario',
      },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(MissingAddressError);
    const message = (err as Error).message;
    expect(message).toContain('a street');
    expect(message).not.toContain('a city');
    expect(message).not.toContain('a postal code');
  });

  it('rejects an unknown contribution', async () => {
    await expect(
      issueReceipt(
        { prisma, storageDir },
        {
          contributionId: 'does-not-exist',
          actorUserId: baseline.cfoUserId,
          reason: 'missing',
          politicalEntityLabel: 'Green Party of Ontario',
        },
      ),
    ).rejects.toBeInstanceOf(ContributionNotFoundError);
  });

  it('rejects a contribution with no metadata yet (intake unresolved)', async () => {
    const contact = await seedContact();
    const contribution = await seedContribution(contact.id);

    await expect(
      issueReceipt(
        { prisma, storageDir },
        {
          contributionId: contribution.id,
          actorUserId: baseline.cfoUserId,
          reason: 'no metadata',
          politicalEntityLabel: 'Green Party of Ontario',
        },
      ),
    ).rejects.toBeInstanceOf(ReceiptIssuanceValidationError);
  });
});
