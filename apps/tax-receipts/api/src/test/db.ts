import { paymentMethodFromQomon, paymentStateFromQomonKind, standardOntarioEsaHolidays } from '@gpo/tax-receipts-core';
import { PrismaClient, type PaymentMethod, type PaymentState } from '../generated/prisma/index.js';
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
  paymentId: string;
}

/** Insert a contact + payment + initial contribution directly (none of the
 *  tables is guarded by invariant 5, so no change-log context is needed for
 *  fixtures). A `qomonTransactionId` also creates the payment's Qomon link,
 *  as an import would; leave it out for a manual-style payment. */
export async function makeContribution(
  prisma: PrismaClient,
  opts: {
    qomonContactId?: bigint | null;
    qomonTransactionId?: bigint | null;
    amountCents: number;
    acceptedAt?: Date;
    contactName?: string;
    contactFirstName?: string;
    contactLastName?: string;
    /** reuse an existing contact instead of creating one */
    contactId?: string;
    method?: PaymentMethod;
    state?: PaymentState;
    externalRef?: string | null;
  },
): Promise<ContributionFixture> {
  const contactId =
    opts.contactId ??
    (
      await prisma.contact.create({
        data: {
          qomonContactId: opts.qomonContactId ?? null,
          name: opts.contactName ?? 'Dana Donor',
          firstName: opts.contactFirstName,
          lastName: opts.contactLastName,
          email: 'dana@example.org',
        },
      })
    ).id;
  const acceptedAt = opts.acceptedAt ?? new Date('2026-03-01T12:00:00Z');
  const payment = await prisma.payment.create({
    data: {
      source: opts.qomonTransactionId != null ? 'QOMON_IMPORT' : 'MANUAL',
      contactId,
      amountCents: opts.amountCents,
      receivedAt: acceptedAt,
      method: opts.method ?? 'CARD',
      state: opts.state ?? 'RECEIVED',
      externalRef: opts.externalRef ?? null,
      ...(opts.qomonTransactionId != null
        ? { qomonLink: { create: { qomonTransactionId: opts.qomonTransactionId, lastSyncedAt: new Date() } } }
        : {}),
      contributions: {
        create: { contactId, amountCents: opts.amountCents, acceptedAt },
      },
    },
    include: { contributions: true },
  });
  return { contactId, contributionId: payment.contributions[0]!.id, paymentId: payment.id };
}

/**
 * Insert a payment + optional Qomon link + contribution and return the
 * contribution row. Accepts the fields the pre-D12 Contribution carried, so a
 * test that used to write `prisma.contribution.create({ data: { ... } })`
 * reads the same: Qomon-shaped facts land on the payment and its link.
 */
export async function createTestContribution(
  db: Pick<PrismaClient, 'payment'>,
  data: {
    contactId: string;
    amountCents: number;
    acceptedAt: Date;
    qomonTransactionId?: bigint | null;
    qomonBundleId?: bigint | null;
    paymentMethodKind?: string | null;
    statusKind?: string;
    externalRef?: string | null;
    comment?: string | null;
    currency?: string;
    syncHash?: string | null;
    deletedInQomonAt?: Date | null;
    status?: 'ACTIVE' | 'SUPERSEDED' | 'REFUNDED';
  },
) {
  const payment = await db.payment.create({
    data: {
      source: data.qomonTransactionId != null ? 'QOMON_IMPORT' : 'MANUAL',
      contactId: data.contactId,
      amountCents: data.amountCents,
      currency: data.currency ?? 'cad',
      receivedAt: data.acceptedAt,
      method: paymentMethodFromQomon(data.paymentMethodKind),
      state: paymentStateFromQomonKind(data.statusKind ?? 'valid'),
      externalRef: data.externalRef ?? null,
      note: data.comment ?? null,
      ...(data.qomonTransactionId != null
        ? {
            qomonLink: {
              create: {
                qomonTransactionId: data.qomonTransactionId,
                qomonBundleId: data.qomonBundleId ?? null,
                qomonPaymentMethodKind: data.paymentMethodKind ?? null,
                syncHash: data.syncHash ?? null,
                deletedInQomonAt: data.deletedInQomonAt ?? null,
                lastSyncedAt: new Date(),
              },
            },
          }
        : {}),
      contributions: {
        create: {
          contactId: data.contactId,
          amountCents: data.amountCents,
          acceptedAt: data.acceptedAt,
          status: data.status ?? 'ACTIVE',
        },
      },
    },
    include: { contributions: true },
  });
  return payment.contributions[0]!;
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
    entityKind?: 'CA' | 'CAMPAIGN' | 'PARTY';
    ridingNumber?: number | null;
    status?: 'ISSUED' | 'CANCELLED' | 'VOID';
    contactNameSnapshot?: string;
    address?: { line1: string; city: string; province: string; postalCode: string };
  },
): Promise<string> {
  const address = opts.address ?? { line1: '1 Main St', city: 'Toronto', province: 'ON', postalCode: 'M1M1M1' };
  const snapshot = await prisma.addressSnapshot.create({
    data: {
      contactId: opts.contactId,
      periodId: opts.periodId,
      line1: address.line1,
      city: address.city,
      province: address.province,
      postalCode: address.postalCode,
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
          status: opts.status ?? 'ISSUED',
          entityKind: opts.entityKind ?? 'PARTY',
          ridingNumber: opts.ridingNumber ?? null,
          periodId: opts.periodId,
          issueDate: new Date(),
          contactId: opts.contactId,
          contactNameSnapshot: opts.contactNameSnapshot ?? 'Dana Donor',
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
