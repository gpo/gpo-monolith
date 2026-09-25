import { remainingEligibleCents, type AllocationRow } from '@gpo/tax-receipts-core';
import { assertIssuanceEnabled } from '../auth/kill-switch.js';
import { addressFrom } from '../contacts/address.js';
import { withChangeLog } from '../changelog/write.js';
import { ContributionNotFoundError } from '../contributions/metadata-edit.js';
import type { PrismaClient, Receipt, ReceiptDelivery } from '../generated/prisma/index.js';
import { AllocationOverageError, MissingAddressError, ReceiptIssuanceValidationError } from './issue.js';

/**
 * Foreign / EO-stock / manual receipt numbers (ticket 3.8): a receipt
 * physically issued outside the tool — an EO-stock pre-printed book, or a
 * handwritten receipt at an event with no connectivity — recorded
 * afterward so it exists in the registry, counts toward invariant 1's
 * allocation limit, and shows up wherever the tool reports on receipts,
 * without ever touching the tool's own `GPO-` sequence (data-model.md §2:
 * "receipt_number tolerates foreign numbers... with a source flag").
 *
 * compliance.md/rollout.md are explicit that this is meant to be rare going
 * forward ("No paper or EO-stock receipting" is the 2026 policy) — this
 * exists for the exception, and for ticket 5.1's legacy import, not as a
 * parallel everyday issuance path.
 *
 * Deliberately does not render a PDF: the physical instrument (the pre-
 * printed stock, the handwritten slip) already exists and *is* the legal
 * receipt; the tool has no template for an arbitrary foreign number format,
 * and inventing one would misrepresent what actually got handed to the
 * donor. `Receipt.pdfArtifactId` stays permanently null for this path —
 * invariant 7 (ticket 3.3) already treats "never set" as a valid terminal
 * state, not just "not yet set." An address snapshot is still captured: the
 * audit trail should show what was on file at the time regardless of which
 * path issued the number.
 */

export class DuplicateForeignReceiptNumberError extends Error {
  readonly statusCode = 409;
  constructor(readonly receiptNumber: string) {
    super(`receipt number "${receiptNumber}" is already recorded`);
    this.name = 'DuplicateForeignReceiptNumberError';
  }
}

/** Guards against recording a "foreign" number that actually collides with
 *  the tool's own `GPO-` sequence format — a real foreign/EO-stock/manual
 *  number looks nothing like the tool's own output, so a match here is
 *  almost certainly an operator mistake, not a real foreign receipt. */
export class ForeignReceiptNumberFormatError extends Error {
  readonly statusCode = 400;
  constructor(readonly receiptNumber: string) {
    super(
      `"${receiptNumber}" looks like a tool-issued sequence number (GPO-NNNNNNNN), ` +
        'not a foreign one — foreign numbers must not use the GPO- sequence format',
    );
    this.name = 'ForeignReceiptNumberFormatError';
  }
}

export interface RecordForeignReceiptDeps {
  prisma: PrismaClient;
}

export interface RecordForeignReceiptInput {
  contributionId: string;
  actorUserId: string;
  /** mandatory (invariant 5); should explain why this receipt exists outside
   *  the tool's own sequence (e.g. "event with no connectivity, EO-stock
   *  book #4, slip 12"). */
  reason: string;
  /** the number already printed on the physical instrument. Must not look
   *  like the tool's own `GPO-` sequence format. */
  receiptNumber: string;
  /** defaults to the contribution's full remaining eligible amount, same as
   *  individual issuance (ticket 3.1). */
  amountCents?: number;
  /** when the physical receipt was actually issued — may predate today (an
   *  event receipt recorded well after the fact). Defaults to now. */
  issueDate?: Date;
  delivery?: ReceiptDelivery;
}

export interface RecordedForeignReceipt {
  id: string;
  receiptNumber: string;
  amountCents: number;
}

const FOREIGN_LOOKS_LIKE_SEQUENCE = /^GPO-\d+$/;

export async function recordForeignReceipt(
  deps: RecordForeignReceiptDeps,
  input: RecordForeignReceiptInput,
): Promise<RecordedForeignReceipt> {
  const { prisma } = deps;
  await assertIssuanceEnabled(prisma);

  if (FOREIGN_LOOKS_LIKE_SEQUENCE.test(input.receiptNumber)) {
    throw new ForeignReceiptNumberFormatError(input.receiptNumber);
  }

  const contribution = await prisma.contribution.findUnique({
    where: { id: input.contributionId },
    include: {
      contact: true,
      metadata: true,
      allocations: { include: { receipt: true } },
    },
  });
  if (!contribution) throw new ContributionNotFoundError(input.contributionId);
  if (!contribution.metadata) {
    throw new ReceiptIssuanceValidationError(
      `contribution ${input.contributionId} has no metadata yet; intake derivation has not resolved this row`,
    );
  }
  const metadata = contribution.metadata;

  const allocationRows: AllocationRow[] = contribution.allocations.map((a) => ({
    receiptId: a.receiptId,
    contributionId: a.contributionId,
    amountCents: a.amountCents,
    receiptStatus: a.receipt.status,
  }));
  const remaining = remainingEligibleCents(
    { id: contribution.id, amountCents: contribution.amountCents, nonDeductibleCents: metadata.nonDeductibleCents },
    allocationRows,
  );
  const amountCents = input.amountCents ?? remaining;
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new ReceiptIssuanceValidationError('amountCents must be a positive integer number of cents');
  }
  if (amountCents > remaining) {
    throw new AllocationOverageError(remaining, amountCents);
  }

  const existing = await prisma.receipt.findUnique({ where: { receiptNumber: input.receiptNumber } });
  if (existing) throw new DuplicateForeignReceiptNumberError(input.receiptNumber);

  const rawAddress = addressFrom(contribution.contact.addresses);
  const missingAddressFields = [
    !rawAddress?.street && 'a street',
    !rawAddress?.city && 'a city',
    !rawAddress?.postalcode && 'a postal code',
  ].filter((f): f is string => f !== false);
  if (missingAddressFields.length > 0) {
    throw new MissingAddressError(contribution.contact.name, String(contribution.contact.qomonContactId), missingAddressFields);
  }
  const address = rawAddress!;
  const addressLine1 = [address.housenumber, address.street].filter(Boolean).join(' ');

  const created: Receipt = await withChangeLog(
    prisma,
    { userId: input.actorUserId, reason: input.reason },
    async (ctx) => {
      const snapshot = await ctx.tx.addressSnapshot.create({
        data: {
          contactId: contribution.contact.id,
          periodId: metadata.periodId,
          line1: addressLine1 || 'unknown',
          city: address.city!,
          province: address.state ?? 'ON',
          postalCode: address.postalcode!,
          country: address.country ?? 'CA',
          source: 'foreign-receipt',
        },
      });
      await ctx.log({ subjectType: 'AddressSnapshot', subjectId: snapshot.id, after: snapshot });

      const receipt = await ctx.tx.receipt.create({
        data: {
          receiptNumber: input.receiptNumber,
          numberSource: 'FOREIGN',
          entityKind: metadata.entityKind,
          ridingNumber: metadata.ridingNumber,
          periodId: metadata.periodId,
          issueDate: input.issueDate ?? new Date(),
          contactId: contribution.contact.id,
          contactNameSnapshot: contribution.contact.name,
          addressSnapshotId: snapshot.id,
          delivery: input.delivery ?? 'MAIL',
        },
      });
      const allocation = await ctx.tx.receiptAllocation.create({
        data: { receiptId: receipt.id, contributionId: contribution.id, amountCents },
      });
      await ctx.log({
        subjectType: 'Receipt',
        subjectId: receipt.id,
        after: { receiptNumber: input.receiptNumber, numberSource: 'FOREIGN', amountCents, contributionId: contribution.id },
      });
      await ctx.log({ subjectType: 'ReceiptAllocation', subjectId: allocation.id, after: allocation });
      return receipt;
    },
  );

  return { id: created.id, receiptNumber: created.receiptNumber, amountCents };
}
