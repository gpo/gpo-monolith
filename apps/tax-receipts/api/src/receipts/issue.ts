import { randomUUID } from 'node:crypto';
import {
  formatReceiptNumber,
  remainingEligibleCents,
  type AllocationRow,
} from '@gpo/tax-receipts-core';
import { storeArtifact } from '../artifacts/store.js';
import { assertIssuanceEnabled } from '../auth/kill-switch.js';
import { addressFrom } from '../contacts/address.js';
import { withChangeLog } from '../changelog/write.js';
import { receiptEntityLabel } from '../leadership/contestants.js';
import { ContributionNotFoundError } from '../contributions/metadata-edit.js';
import type { Contact, Contribution, PrismaClient, Receipt, ReceiptDelivery } from '../generated/prisma/index.js';
import { renderReceiptPdf } from './pdf.js';
import { combinationConflicts, receiptPrintedFields } from './combined.js';
import { getReceiptSettings } from './settings.js';

/**
 * Individual receipt issuance (ticket 3.1, the first slice of Phase 3).
 * One contribution -> one receipt, covering some or all of what's still
 * eligible on it (invariant 1, checked via `remainingEligibleCents`).
 *
 * `issueCombinedReceipt` is the other shape (EO evaluation rows 43 and 46):
 * several of one donor's contributions on a single new receipt, one
 * `ReceiptAllocation` each, each for its full remaining eligible amount.
 * What such a receipt prints, and which contributions may share one, is
 * `combined.ts`'s call. Both shapes share `issueForLines`, so the sequence,
 * snapshot, change-log, and PDF steps cannot drift apart.
 *
 * Sequencing: the counter increment and the deferred change-log/invariant-3
 * triggers (ticket 0.3) are the actual guarantee; this function just has to
 * do the increment and the Receipt/ReceiptAllocation writes in the same
 * change-logged transaction, the same shape as `test/db.ts`'s `issueReceipt`
 * fixture helper.
 */

const SEQUENCE_PREFIX = 'GPO-';

export class ReceiptIssuanceValidationError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ReceiptIssuanceValidationError';
  }
}

/** Invariant 1: the request would allocate more than the contribution has
 *  left to give (data-model §2, guarantee G1). */
export class AllocationOverageError extends Error {
  readonly statusCode = 409;
  constructor(
    readonly remainingCents: number,
    readonly requestedCents: number,
  ) {
    super(
      `requested ${requestedCents}c but only ${remainingCents}c is still eligible for this contribution`,
    );
    this.name = 'AllocationOverageError';
  }
}

/** No mailable address on file (a real gap, not something to paper over on a
 *  legal receipt — the address is a required printed field on the receipt
 *  itself, not just a mailing detail) — rule B1's out-of-province check is a
 *  separate, still-open question (O34); this only checks an address exists
 *  at all. */
export class MissingAddressError extends Error {
  readonly statusCode = 422;
  constructor(
    readonly contactName: string,
    readonly qomonContactId: string,
    readonly missingFields: readonly string[],
  ) {
    super(
      `${contactName} (Qomon contact ${qomonContactId}) is missing ${missingFields.join(', ')} on their address` +
        ' on file; add it in Qomon and refresh this contribution before issuing a receipt',
    );
    this.name = 'MissingAddressError';
  }
}

/** The contributions disagree on something a receipt prints or reports
 *  once, so they cannot share one (`combined.ts`). */
export class CombinedReceiptConflictError extends Error {
  readonly statusCode = 400;
  constructor(readonly conflicts: readonly string[]) {
    super(`these contributions cannot share one receipt: they differ in ${conflicts.join(', ')}`);
    this.name = 'CombinedReceiptConflictError';
  }
}

export interface IssueReceiptDeps {
  prisma: PrismaClient;
  storageDir: string;
}

export interface IssueReceiptInput {
  contributionId: string;
  actorUserId: string;
  /** mandatory (invariant 5); a blank reason fails before any write. */
  reason: string;
  /** defaults to the contribution's full remaining eligible amount. */
  amountCents?: number;
  delivery?: ReceiptDelivery;
  /** the EO-facing "received by" display name for this contribution's
   *  entity (e.g. the party, or a specific CA/campaign). Not derived here:
   *  the exact wording EO expects is a compliance.md question, not one to
   *  guess at on a legal receipt. */
  politicalEntityLabel: string;
}

export interface IssuedReceipt {
  id: string;
  receiptNumber: string;
  amountCents: number;
  pdfArtifactId: string;
}

type ContributionForIssuance = Contribution & {
  contact: Contact;
  allocations: { receiptId: string; contributionId: string; amountCents: number; receipt: { status: Receipt['status'] } }[];
};

const ISSUANCE_INCLUDE = { contact: true, allocations: { include: { receipt: true } } } as const;

function remainingFor(contribution: ContributionForIssuance): number {
  const allocationRows: AllocationRow[] = contribution.allocations.map((a) => ({
    receiptId: a.receiptId,
    contributionId: a.contributionId,
    amountCents: a.amountCents,
    receiptStatus: a.receipt.status,
  }));
  return remainingEligibleCents(
    {
      id: contribution.id,
      amountCents: contribution.amountCents,
      nonDeductibleCents: contribution.nonDeductibleCents,
    },
    allocationRows,
  );
}

function assertHasMetadata(contribution: Contribution): void {
  if (contribution.periodId === null) {
    throw new ReceiptIssuanceValidationError(
      `contribution ${contribution.id} has no metadata yet; intake derivation has not resolved this row`,
    );
  }
}

export async function issueReceipt(
  deps: IssueReceiptDeps,
  input: IssueReceiptInput,
): Promise<IssuedReceipt> {
  const { prisma } = deps;
  await assertIssuanceEnabled(prisma);

  const contribution = await prisma.contribution.findUnique({
    where: { id: input.contributionId },
    include: ISSUANCE_INCLUDE,
  });
  if (!contribution) throw new ContributionNotFoundError(input.contributionId);
  assertHasMetadata(contribution);

  const remaining = remainingFor(contribution);
  const amountCents = input.amountCents ?? remaining;
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new ReceiptIssuanceValidationError('amountCents must be a positive integer number of cents');
  }
  if (amountCents > remaining) {
    throw new AllocationOverageError(remaining, amountCents);
  }

  return issueForLines(deps, [{ contribution, amountCents }], input);
}

export interface IssueCombinedReceiptInput {
  /** one donor's contributions, all agreeing on what a receipt prints once
   *  (`combined.ts`); each is receipted for its full remaining amount */
  contributionIds: string[];
  actorUserId: string;
  /** mandatory (invariant 5). */
  reason: string;
  delivery?: ReceiptDelivery;
  politicalEntityLabel: string;
}

/** One new receipt for several contributions (EO evaluation rows 43, 46). */
export async function issueCombinedReceipt(
  deps: IssueReceiptDeps,
  input: IssueCombinedReceiptInput,
): Promise<IssuedReceipt> {
  const { prisma } = deps;
  await assertIssuanceEnabled(prisma);

  const ids = [...new Set(input.contributionIds)];
  if (ids.length === 0) {
    throw new ReceiptIssuanceValidationError('a combined receipt needs at least one contribution');
  }
  const contributions = await prisma.contribution.findMany({
    where: { id: { in: ids } },
    include: ISSUANCE_INCLUDE,
  });
  const missing = ids.find((id) => !contributions.some((c) => c.id === id));
  if (missing) throw new ContributionNotFoundError(missing);
  contributions.forEach(assertHasMetadata);
  const inactive = contributions.find((c) => c.status !== 'ACTIVE');
  if (inactive) {
    throw new ReceiptIssuanceValidationError(`contribution ${inactive.id} is ${inactive.status}, not active`);
  }
  const conflicts = combinationConflicts(contributions);
  if (conflicts.length > 0) throw new CombinedReceiptConflictError(conflicts);

  const lines = contributions
    .sort((a, b) => a.acceptedAt.getTime() - b.acceptedAt.getTime() || a.id.localeCompare(b.id))
    .map((contribution) => ({ contribution, amountCents: remainingFor(contribution) }));
  const spent = lines.find((l) => l.amountCents <= 0);
  if (spent) {
    throw new ReceiptIssuanceValidationError(
      `contribution ${spent.contribution.id} has nothing left to receipt; leave it out of the combined receipt`,
    );
  }

  return issueForLines(deps, lines, input);
}

/** The shared issuance core: one receipt, one allocation per line. Callers
 *  have already checked invariant 1 and that the lines may share a receipt. */
async function issueForLines(
  deps: IssueReceiptDeps,
  lines: { contribution: ContributionForIssuance; amountCents: number }[],
  input: { actorUserId: string; reason: string; delivery?: ReceiptDelivery; politicalEntityLabel: string },
): Promise<IssuedReceipt> {
  const { prisma } = deps;
  const contributions = lines.map((l) => l.contribution);
  const printed = receiptPrintedFields(contributions);
  const primary = printed.primary;
  const contact = primary.contact;
  const periodId = primary.periodId!;
  const amountCents = lines.reduce((sum, l) => sum + l.amountCents, 0);

  const rawAddress = addressFrom(contact.addresses);
  const missingAddressFields = [
    !rawAddress?.street && 'a street',
    !rawAddress?.city && 'a city',
    !rawAddress?.postalcode && 'a postal code',
  ].filter((f): f is string => f !== false);
  if (missingAddressFields.length > 0) {
    throw new MissingAddressError(contact.name, String(contact.qomonContactId), missingAddressFields);
  }
  const address = rawAddress!;
  const addressLine1 = [address.housenumber, address.street].filter(Boolean).join(' ');
  const province = address.state ?? 'ON';
  const country = address.country ?? 'CA';

  // One correlation id ties the DB-write transaction and the follow-up
  // pdfArtifactId update into a single audit-trail cascade.
  const correlationId = randomUUID();

  const created = await withChangeLog(
    prisma,
    { userId: input.actorUserId, reason: input.reason, correlationId },
    async (ctx) => {
      const snapshot = await ctx.tx.addressSnapshot.create({
        data: {
          contactId: contact.id,
          periodId: periodId,
          line1: addressLine1 || 'unknown',
          city: address.city!,
          province,
          postalCode: address.postalcode!,
          country,
          source: 'issuance',
        },
      });
      // The snapshot, not the live Contact cache, is what's legally on the
      // receipt — this is the audit-relevant record of "what address was
      // printed," frozen at issuance, immune to any later correction of the
      // donor's address in Qomon.
      await ctx.log({
        subjectType: 'AddressSnapshot',
        subjectId: snapshot.id,
        after: snapshot,
      });

      const seq = await ctx.tx.receiptSequence.update({
        where: { prefix: SEQUENCE_PREFIX },
        data: { counter: { increment: 1 } },
      });
      const receiptNumber = formatReceiptNumber(SEQUENCE_PREFIX, seq.counter);

      const receipt = await ctx.tx.receipt.create({
        data: {
          receiptNumber,
          numberSource: 'SEQUENCE',
          entityKind: primary.entityKind,
          ridingNumber: primary.ridingNumber,
          periodId: periodId,
          issueDate: new Date(),
          contactId: contact.id,
          contactNameSnapshot: contact.name,
          addressSnapshotId: snapshot.id,
          delivery: input.delivery ?? 'MAIL',
        },
      });
      await ctx.log({
        subjectType: 'Receipt',
        subjectId: receipt.id,
        after:
          lines.length === 1
            ? { receiptNumber, amountCents, contributionId: primary.id }
            : { receiptNumber, amountCents, contributionIds: contributions.map((c) => c.id) },
      });
      for (const line of lines) {
        const allocation = await ctx.tx.receiptAllocation.create({
          data: { receiptId: receipt.id, contributionId: line.contribution.id, amountCents: line.amountCents },
        });
        await ctx.log({
          subjectType: 'ReceiptAllocation',
          subjectId: allocation.id,
          after: allocation,
        });
      }
      return receipt;
    },
  );

  const pdfBytes = await renderReceiptPdf({
    receiptNumber: created.receiptNumber,
    issueDate: created.issueDate,
    acceptedAt: printed.acceptedFrom,
    acceptedThrough: printed.acceptedThrough,
    eligibleAmountCents: amountCents,
    isGoodsServices: printed.goodsServices,
    politicalEntityLabel: await receiptEntityLabel(prisma, primary, input.politicalEntityLabel),
    eoContributorId: printed.eoContributorId,
    contributorName: contact.name,
    addressLine1,
    addressLine2: null,
    city: address.city!,
    province,
    postalCode: address.postalcode!,
    country,
    layout: (await getReceiptSettings(prisma)).receiptLayout,
  });
  const artifact = await storeArtifact(
    { prisma, storageDir: deps.storageDir },
    { kind: 'PDF', bytes: pdfBytes, extension: 'pdf' },
  );

  const withPdf: Receipt = await withChangeLog(
    prisma,
    { userId: input.actorUserId, reason: input.reason, correlationId },
    async (ctx) => {
      const updated = await ctx.tx.receipt.update({
        where: { id: created.id },
        data: { pdfArtifactId: artifact.id },
      });
      await ctx.log({
        subjectType: 'Receipt',
        subjectId: created.id,
        after: { pdfArtifactId: artifact.id },
      });
      return updated;
    },
  );

  return {
    id: withPdf.id,
    receiptNumber: withPdf.receiptNumber,
    amountCents,
    pdfArtifactId: artifact.id,
  };
}
