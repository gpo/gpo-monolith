import { standardOntarioEsaHolidays } from '@gpo/tax-receipts-core';
import { PrismaClient } from '../generated/prisma/index.js';
import { withChangeLog } from '../changelog/write.js';

let shared: PrismaClient | undefined;

export function testPrisma(): PrismaClient {
  shared ??= new PrismaClient();
  return shared;
}

/** Wipe every table (TRUNCATE bypasses the row-level delete guards by design). */
export async function resetDb(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  if (list) {
    await prisma.$executeRawUnsafe(
      `TRUNCATE ${list} RESTART IDENTITY CASCADE`,
    );
  }
}

export interface Baseline {
  periodId: number;
  cfoUserId: string;
  adminUserId: string;
  designateUserId: string;
}

/** Minimal shared fixture: one period, a receipt sequence, the kill switch,
 *  and three users (party CFO, administrator, RTD designate). */
export async function seedBaseline(prisma: PrismaClient): Promise<Baseline> {
  await prisma.period.create({
    data: {
      id: 67,
      name: '2026 Annual',
      kind: 'ANNUAL',
      startsAt: new Date('2026-01-01T05:00:00Z'),
      endsAt: new Date('2027-01-01T05:00:00Z'),
    },
  });
  await prisma.receiptSequence.create({
    data: { prefix: 'GPO-', counter: 402_509 },
  });
  await prisma.issuanceKillSwitch.create({ data: { id: 'singleton' } });
  await prisma.businessDayCalendar.create({
    data: { year: 2026, holidays: standardOntarioEsaHolidays(2026) },
  });
  await prisma.contributionLimit.create({
    data: { year: 2026, bucket: 'PARTY', amountCents: 500_000 },
  });

  const cfo = await prisma.user.create({
    data: {
      email: 'cfo@gpo.test',
      name: 'CFO',
      role: 'party_cfo',
      passwordHash: 'x',
      allRidings: true,
    },
  });
  const admin = await prisma.user.create({
    data: {
      email: 'admin@gpo.test',
      name: 'Admin',
      role: 'administrator',
      passwordHash: 'x',
      allRidings: true,
    },
  });
  const designate = await prisma.user.create({
    data: {
      email: 'designate@gpo.test',
      name: 'Designate',
      role: 'filer',
      passwordHash: 'x',
      isCfoDesignate: true,
      allRidings: true,
    },
  });

  return {
    periodId: 67,
    cfoUserId: cfo.id,
    adminUserId: admin.id,
    designateUserId: designate.id,
  };
}

export interface ContributionFixture {
  contactId: string;
  contributionId: string;
}

/** Insert a contact + contribution directly (neither table is guarded by
 *  invariant 5, so no change-log context is needed for fixtures). */
export async function makeContribution(
  prisma: PrismaClient,
  opts: {
    qomonContactId: bigint;
    qomonTransactionId: bigint;
    amountCents: number;
    acceptedAt?: Date;
  },
): Promise<ContributionFixture> {
  const contact = await prisma.contact.create({
    data: {
      qomonContactId: opts.qomonContactId,
      name: 'Dana Donor',
      email: 'dana@example.org',
    },
  });
  const contribution = await prisma.contribution.create({
    data: {
      qomonTransactionId: opts.qomonTransactionId,
      contactId: contact.id,
      amountCents: opts.amountCents,
      acceptedAt: opts.acceptedAt ?? new Date('2026-03-01T12:00:00Z'),
    },
  });
  return { contactId: contact.id, contributionId: contribution.id };
}

/**
 * Issue a receipt with one allocation, the proper way: reserve from the
 * sequence, then create the address snapshot, receipt, and allocation inside
 * one change-logged transaction. Returns the receipt id.
 */
export async function issueReceipt(
  prisma: PrismaClient,
  opts: {
    contactId: string;
    contributionId: string;
    periodId: number;
    amountCents: number;
    actorUserId: string;
    reason?: string;
    /** override the reserved number (to test invariant 3 rejections). */
    forceNumber?: string;
    numberSource?: 'SEQUENCE' | 'FOREIGN';
  },
): Promise<string> {
  const snapshot = await prisma.addressSnapshot.create({
    data: {
      contactId: opts.contactId,
      periodId: opts.periodId,
      line1: '1 Main St',
      city: 'Toronto',
      province: 'ON',
      postalCode: 'M1M1M1',
      source: 'test',
    },
  });

  let number = opts.forceNumber;
  if (!number) {
    const seq = await prisma.receiptSequence.update({
      where: { prefix: 'GPO-' },
      data: { counter: { increment: 1 } },
    });
    number = `GPO-${String(seq.counter).padStart(8, '0')}`;
  }

  return withChangeLog(
    prisma,
    { userId: opts.actorUserId, reason: opts.reason ?? 'test issuance' },
    async (ctx) => {
      const receipt = await ctx.tx.receipt.create({
        data: {
          receiptNumber: number!,
          numberSource: opts.numberSource ?? 'SEQUENCE',
          entityKind: 'PARTY',
          periodId: opts.periodId,
          issueDate: new Date(),
          contactId: opts.contactId,
          contactNameSnapshot: 'Dana Donor',
          addressSnapshotId: snapshot.id,
        },
      });
      await ctx.tx.receiptAllocation.create({
        data: {
          receiptId: receipt.id,
          contributionId: opts.contributionId,
          amountCents: opts.amountCents,
        },
      });
      await ctx.log({
        subjectType: 'Receipt',
        subjectId: receipt.id,
        after: { receiptNumber: receipt.receiptNumber, amountCents: opts.amountCents },
      });
      return receipt.id;
    },
  );
}
