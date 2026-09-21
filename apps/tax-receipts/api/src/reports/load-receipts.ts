import type {
  EntityKind,
  PrismaClient,
  ReceivedBy,
  ReceiptStatus,
} from '../generated/prisma/index.js';

/**
 * Shared receipt loading for the EO annual reports (ALL, ticket 4.1; S2P2,
 * ticket 4.2). Both reports are built from the exact same receipt set for a
 * scope — REP2 ("per-entity contribution sum equals... the filed return
 * total") only holds if they agree on what's included — so this is the one
 * place that decides which receipts are in scope and enforces the guards
 * (single allocation, metadata present) both reports need identically.
 */

export interface ReportScope {
  periodId: number;
  /** both omitted (or both `undefined`) = the combined, all-entities file.
   *  Supply both for one entity's file: `ridingNumber: null` for PARTY,
   *  a riding number for CA/CAMPAIGN. */
  ridingNumber?: number | null;
  entityKind?: EntityKind;
}

/** `ridingNumber` and `entityKind` must both be supplied (one entity's file)
 *  or both omitted (the combined file) — a half-scoped call (e.g. a riding
 *  with no entity kind) isn't a file EO or any CFO asks for, so it's rejected
 *  rather than silently generating a `ridingNumber`-filtered but
 *  entity-kind-unfiltered mix. */
export class ReportScopeError extends Error {
  constructor() {
    super('ridingNumber and entityKind must both be supplied (per-entity) or both omitted (combined)');
    this.name = 'ReportScopeError';
  }
}

/**
 * A receipt with more than one allocation (several contributions consolidated
 * onto one receipt) can't be reported yet: which contribution's accepted date
 * prints, and whose non-deductible amount governs, is an open question ticket
 * 3.1 already declined to guess at for issuance itself — it belongs with the
 * correction/consolidation workflow (tickets 3.10/3.11), not these
 * generators. No such receipt can exist today (3.1 and 3.12 only ever issue
 * one contribution -> one receipt), so this is a forward guard, not a live
 * gap.
 */
export class MultiAllocationReceiptError extends Error {
  constructor(
    readonly receiptId: string,
    readonly receiptNumber: string,
    readonly allocationCount: number,
  ) {
    super(
      `receipt ${receiptNumber} has ${allocationCount} allocations; the EO report generators only ` +
        'support one contribution per receipt so far (see this file\'s MultiAllocationReceiptError doc comment)',
    );
    this.name = 'MultiAllocationReceiptError';
  }
}

export class MissingContributionMetadataError extends Error {
  constructor(readonly receiptNumber: string, readonly contributionId: string) {
    super(
      `receipt ${receiptNumber}'s contribution ${contributionId} has no metadata; intake derivation ` +
        'has not resolved this row yet',
    );
    this.name = 'MissingContributionMetadataError';
  }
}

export interface LoadedReceiptRow {
  receiptId: string;
  receiptNumber: string;
  status: ReceiptStatus;
  entityKind: EntityKind;
  ridingNumber: number | null;
  periodId: number;
  issueDate: Date;
  /** the receipt's total, already summed over its allocations (invariant: a
   *  receipt has no stored total, data-model.md §2). Since only
   *  single-allocation receipts are supported (see
   *  `MultiAllocationReceiptError`), this is just that one allocation's
   *  amount. */
  amountCents: number;
  acceptedAt: Date;
  goodsServices: boolean;
  receivedBy: ReceivedBy;
  /** ContributionMetadata.eoContributorId. Null in the common case today —
   *  no ticket populates it yet (data-model.md §3 marks it optional). EO's
   *  spec calls this mandatory for GPO (eo-reporting.md §1); tracked as
   *  open-questions.md O38, not fabricated here. */
  eoContributorId: string | null;
  contactId: string;
  /** from Contact.lastName/firstName (ticket 4.1's schema addition) —
   *  Qomon's own name split, not a heuristic parse of the joined display
   *  name. Falls back to the joined name in the last-name slot when Qomon
   *  never supplied a split (e.g. an org-only contact), so no row silently
   *  loses the donor's identity. */
  contributorLastName: string;
  contributorFirstName: string;
  addressLine1: string;
  city: string;
  province: string;
  postalCode: string;
}

export async function loadReportReceipts(
  prisma: PrismaClient,
  scope: ReportScope,
): Promise<LoadedReceiptRow[]> {
  const hasEntityKind = scope.entityKind !== undefined;
  const hasRidingNumber = scope.ridingNumber !== undefined;
  if (hasEntityKind !== hasRidingNumber) {
    throw new ReportScopeError();
  }

  const receipts = await prisma.receipt.findMany({
    where: {
      periodId: scope.periodId,
      ...(scope.entityKind !== undefined ? { entityKind: scope.entityKind } : {}),
      ...(scope.ridingNumber !== undefined ? { ridingNumber: scope.ridingNumber } : {}),
    },
    include: {
      addressSnapshot: true,
      contact: true,
      allocations: { include: { contribution: { include: { metadata: true } } } },
    },
    orderBy: { receiptNumber: 'asc' },
  });

  return receipts.map((receipt): LoadedReceiptRow => {
    if (receipt.allocations.length !== 1) {
      throw new MultiAllocationReceiptError(receipt.id, receipt.receiptNumber, receipt.allocations.length);
    }
    const allocation = receipt.allocations[0]!;
    const contribution = allocation.contribution;
    const metadata = contribution.metadata;
    if (!metadata) {
      throw new MissingContributionMetadataError(receipt.receiptNumber, contribution.id);
    }

    return {
      receiptId: receipt.id,
      receiptNumber: receipt.receiptNumber,
      status: receipt.status,
      entityKind: receipt.entityKind,
      ridingNumber: receipt.ridingNumber,
      periodId: receipt.periodId,
      issueDate: receipt.issueDate,
      amountCents: allocation.amountCents,
      acceptedAt: contribution.acceptedAt,
      goodsServices: metadata.goodsServices,
      receivedBy: metadata.receivedBy,
      eoContributorId: metadata.eoContributorId,
      contactId: receipt.contact.id,
      contributorLastName: receipt.contact.lastName ?? receipt.contact.name,
      contributorFirstName: receipt.contact.firstName ?? '',
      addressLine1: [receipt.addressSnapshot.line1, receipt.addressSnapshot.line2]
        .filter((part): part is string => Boolean(part))
        .join(' '),
      city: receipt.addressSnapshot.city,
      province: receipt.addressSnapshot.province,
      postalCode: receipt.addressSnapshot.postalCode,
    };
  });
}
