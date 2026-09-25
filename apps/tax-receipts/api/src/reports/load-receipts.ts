import {
  runRepGate,
  type PeriodRow,
  type ReceivableFlag,
  type RepGateFinding,
  type RidingRow,
} from '@gpo/tax-receipts-core';
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
 * place that decides which receipts are in scope, enforces the guards
 * (single allocation, metadata present) both reports need identically, and
 * — ticket 4.3 — runs the REP4/REP6 export gate before returning anything,
 * throwing `ReportExportBlockedError` if it finds a blocking problem. Both
 * generators get this for free; neither can accidentally skip it.
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
 * generators. Such a receipt can exist now: ticket 3.2's
 * `allocateToReceipt` (`receipts/allocate.ts`) can attach a second
 * contribution to an already-issued receipt, deliberately without deciding
 * either question, so this guard is a live gap as of 3.2, not just a forward
 * one — nothing calls `allocateToReceipt` yet (no ticket before 3.10 has a
 * reason to), but a report run against a period where it has been used will
 * hit this error until 3.10/3.11 resolve the two questions above.
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

/** The report-export gate (ticket 4.3, REP4/REP6) found a blocking problem —
 *  eo-reporting.md §2: "failures block export with named rows". */
export class ReportExportBlockedError extends Error {
  constructor(readonly findings: RepGateFinding[]) {
    super(
      `${findings.length} report-export finding(s) block this report: ` +
        findings.map((f) => `${f.ruleRef} on ${f.receiptNumber}`).join('; '),
    );
    this.name = 'ReportExportBlockedError';
  }
}

export interface LoadedReceiptRow {
  receiptId: string;
  receiptNumber: string;
  status: ReceiptStatus;
  /** Receipt.lost: an ISSUED lost receipt files as Receipt_Status L (O41). */
  lost: boolean;
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
  /** Contribution.eoContributorId. Null in the common case today —
   *  no ticket populates it yet (data-model.md §3 marks it optional). EO's
   *  spec calls this mandatory for GPO (eo-reporting.md §1); tracked as
   *  open-questions.md O38, not fabricated here. */
  eoContributorId: string | null;
  /** Contribution.processedDate — feeds the REP6 receivable flag
   *  (ticket 4.3). Null when the accounting date never differs from
   *  acceptance. */
  processedDate: Date | null;
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

/** `EntityReport.includedSet`'s shape (ticket 4.5): not just which receipts
 *  fed the report (`receiptIds`, needed for `EntityReportReceipt` links) but
 *  the actual rendered rows — a true point-in-time snapshot (the schema's
 *  own doc comment already called for this: "recorded as a point-in-time
 *  snapshot"). `entity-reports.ts`'s drift check rebuilds fresh rows for the
 *  same scope and diffs them against `rows` to answer rule E5's "did
 *  anything included change" — no separate hook is wired into every mutation
 *  path that could affect a reported row; the check is live, recomputed on
 *  read, matching how `space/issuance.ts`'s gate already works. */
export interface EntityReportIncludedSet<Row> {
  receiptIds: string[];
  rows: Row[];
}

export interface LoadedReport {
  rows: LoadedReceiptRow[];
  /** REP6's non-blocking receivable flags (see rep-gate.ts's header
   *  comment) — carried through so a caller with somewhere to put them
   *  (e.g. ticket 4.6's AR-1 "current-year notes for prior-year
   *  corrections") doesn't have to re-run the gate. */
  receivable: ReceivableFlag[];
}

export async function loadReportReceipts(prisma: PrismaClient, scope: ReportScope): Promise<LoadedReport> {
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
      allocations: { include: { contribution: true } },
    },
    orderBy: { receiptNumber: 'asc' },
  });

  const rows = receipts.map((receipt): LoadedReceiptRow => {
    if (receipt.allocations.length !== 1) {
      throw new MultiAllocationReceiptError(receipt.id, receipt.receiptNumber, receipt.allocations.length);
    }
    const allocation = receipt.allocations[0]!;
    const contribution = allocation.contribution;
    if (contribution.periodId === null) {
      throw new MissingContributionMetadataError(receipt.receiptNumber, contribution.id);
    }

    return {
      receiptId: receipt.id,
      receiptNumber: receipt.receiptNumber,
      status: receipt.status,
      lost: receipt.lost,
      entityKind: receipt.entityKind,
      ridingNumber: receipt.ridingNumber,
      periodId: receipt.periodId,
      issueDate: receipt.issueDate,
      amountCents: allocation.amountCents,
      acceptedAt: contribution.acceptedAt,
      goodsServices: contribution.goodsServices,
      receivedBy: contribution.receivedBy,
      eoContributorId: contribution.eoContributorId,
      processedDate: contribution.processedDate,
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

  const { findings, receivable } = await runReportExportGate(prisma, rows);
  if (findings.length > 0) {
    throw new ReportExportBlockedError(findings);
  }

  return { rows, receivable };
}

/** Fetches the Period/Riding rows the loaded receipts reference and runs the
 *  pure REP4/REP6 gate (`@gpo/tax-receipts-core`'s `rep-gate.ts`) over them. */
async function runReportExportGate(
  prisma: PrismaClient,
  rows: readonly LoadedReceiptRow[],
): Promise<{ findings: RepGateFinding[]; receivable: ReceivableFlag[] }> {
  if (rows.length === 0) return { findings: [], receivable: [] };

  const periodIds = [...new Set(rows.map((r) => r.periodId))];
  const ridingNumbers = [...new Set(rows.map((r) => r.ridingNumber).filter((n): n is number => n !== null))];

  const [periodRecords, ridingRecords] = await Promise.all([
    prisma.period.findMany({ where: { id: { in: periodIds } } }),
    ridingNumbers.length > 0
      ? prisma.riding.findMany({ where: { ridingNumber: { in: ridingNumbers } } })
      : Promise.resolve([]),
  ]);

  const periods = new Map<number, PeriodRow>(
    periodRecords.map((p) => [
      p.id,
      { id: p.id, name: p.name, kind: p.kind, ridingNumbers: p.ridingNumbers, startsAt: p.startsAt, endsAt: p.endsAt },
    ]),
  );
  const ridings = new Map<number, RidingRow>(
    ridingRecords.map((r) => [r.ridingNumber, { ridingNumber: r.ridingNumber, active: r.active }]),
  );

  return runRepGate(
    rows.map((r) => ({
      receiptId: r.receiptId,
      receiptNumber: r.receiptNumber,
      entityKind: r.entityKind,
      ridingNumber: r.ridingNumber,
      periodId: r.periodId,
      acceptedAt: r.acceptedAt,
      processedDate: r.processedDate,
    })),
    { periods, ridings },
  );
}
