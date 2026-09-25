import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  formatReceiptNumber,
  remainingEligibleCents,
  type AllocationRow,
} from '@gpo/tax-receipts-core';
import { storeArtifact, type ArtifactStoreDeps } from '../artifacts/store.js';
import { getKillSwitch } from '../auth/kill-switch.js';
import { withChangeLog, type ChangeLogContext } from '../changelog/write.js';
import { addressFrom } from '../contacts/address.js';
import { ContributionNotFoundError } from '../contributions/metadata-edit.js';
import type {
  Contact,
  Contribution,
  EntityKind,
  Payment,
  PrismaClient,
  ReceiptDelivery,
  ReceivedBy,
} from '../generated/prisma/index.js';
import { renderReceiptPdf } from '../receipts/pdf.js';
import { runValidationForContribution } from '../validation/run.js';
import { renderCancellationNoticePdf } from './cancellation-notice.js';
import { OWED_DC1A, OWED_RETURN_NOTE, openOwedToEo } from './owed-to-eo.js';

/**
 * The contribution-correction engine (corrections.md, D12). Every correction
 * that changes what a contribution says (amount, donor, entity, riding, period,
 * date) or retires it (refund) runs through here, so they all share one
 * cascade and one commit:
 *
 *  1. each affected ACTIVE contribution is SUPERSEDED by one or more new rows
 *     on the same payment (or marked REFUNDED); nothing is edited in place,
 *     and nothing is written back to Qomon;
 *  2. every ISSUED receipt that allocated to a retired contribution is
 *     CANCELLED, with a watermarked notice when it had a PDF;
 *  3. receipts are issued for the replacements: the donor's own receipt is
 *     reissued (carrying its unaffected contributions along), and a
 *     contribution moved to another donor or entity gets a fresh receipt;
 *  4. anything EO has already seen is queued on the owed-to-EO list: a DC-1A
 *     for an RTD-reported contribution, a return note for a receipt inside a
 *     filed annual return;
 *  5. open validation work on a retired row is closed, and the replacements
 *     are validated.
 *
 * `previewCorrection` computes the whole cascade without writing anything
 * (corrections.md principle 2); `applyCorrection` recomputes it, refuses when
 * it has blockers, and commits steps 1 to 5 in one change-logged transaction
 * under one correlation id. PDFs are rendered after that commit and attached
 * in a second write sharing the correlation id, as `issueReceipt` does.
 *
 * The named actions (`actions.ts`) only build a change list for this engine.
 */

export class CorrectionValidationError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'CorrectionValidationError';
  }
}

export class ContributionNotActiveError extends Error {
  readonly statusCode = 409;
  constructor(
    readonly contributionId: string,
    readonly status: string,
  ) {
    super(`contribution ${contributionId} is ${status}; correct the row that replaced it`);
    this.name = 'ContributionNotActiveError';
  }
}

/** Invariant 1 on the payment: the ACTIVE contributions may not add up to more
 *  than the payment. */
export class PaymentSumExceededError extends Error {
  readonly statusCode = 409;
  constructor(
    readonly paymentId: string,
    readonly contributionsCents: number,
    readonly paymentCents: number,
  ) {
    super(
      `the contributions on payment ${paymentId} would total ${contributionsCents}c but the payment is ` +
        `${paymentCents}c; if the payment amount was mis-recorded, correct it in the same action`,
    );
    this.name = 'PaymentSumExceededError';
  }
}

export class CorrectionBlockedError extends Error {
  readonly statusCode = 409;
  constructor(readonly blockers: string[]) {
    super(`this correction is blocked: ${blockers.join('; ')}`);
    this.name = 'CorrectionBlockedError';
  }
}

export type CorrectionAction =
  | 'CORRECT_AMOUNT'
  | 'MOVE'
  | 'SPLIT_CONTRIBUTION'
  | 'REALLOCATE'
  | 'REFUND'
  | 'SPLIT_RECEIPT'
  | 'MERGE_CONTACTS';

/** One replacement row. Everything but the amount defaults from the row it
 *  replaces. */
export interface ReplacementSpec {
  amountCents: number;
  contactId?: string;
  acceptedAt?: Date;
  periodId?: number | null;
  ridingNumber?: number | null;
  entityKind?: EntityKind;
  receivedBy?: ReceivedBy;
  goodsServices?: boolean;
  /** required when the original has a non-deductible amount and the
   *  replacement's amount differs from it (the tool will not guess). */
  nonDeductibleCents?: number;
  note?: string | null;
}

export type ContributionChange =
  | { kind: 'supersede'; contributionId: string; replacements: ReplacementSpec[] }
  | { kind: 'refund'; contributionId: string };

export interface CorrectionInput {
  action: CorrectionAction;
  actorUserId: string;
  /** mandatory (invariant 5; corrections.md requires a reason on every action). */
  reason: string;
  changes: ContributionChange[];
  /** the payment itself was mis-recorded (action 4): set its amount in the same action. */
  paymentAmountCorrection?: { paymentId: string; amountCents: number };
  /** the EO-facing "received by" wording; same open compliance question as
   *  issuance (3.1), so caller-supplied. Required when the cascade issues receipts. */
  politicalEntityLabel?: string;
  /** per-entity override, keyed `${entityKind}:${ridingNumber ?? ''}`, for a
   *  cascade that issues receipts under more than one entity. */
  entityLabels?: Record<string, string>;
  delivery?: ReceiptDelivery;
  /** extra writes that must commit or fail with the correction (a contact merge
   *  flags the merged-away contact in the same transaction). With this set, an
   *  empty change list is allowed. */
  inTransaction?: (ctx: ChangeLogContext) => Promise<void>;
  /** extra non-blocking follow-ups for the preview (e.g. "merge it in Qomon too") */
  extraFollowUps?: string[];
}

export interface PlannedContribution {
  ref: string;
  contactId: string;
  contactName: string;
  amountCents: number;
  acceptedAt: Date;
  periodId: number | null;
  ridingNumber: number | null;
  entityKind: EntityKind;
  receivedBy: ReceivedBy;
  goodsServices: boolean;
  nonDeductibleCents: number;
  note: string | null;
}

export interface PlannedChange {
  contributionId: string;
  kind: 'supersede' | 'refund';
  before: {
    contactId: string;
    contactName: string;
    amountCents: number;
    acceptedAt: Date;
    periodId: number | null;
    ridingNumber: number | null;
    entityKind: EntityKind;
  };
  replacements: PlannedContribution[];
}

export interface PlannedPayment {
  paymentId: string;
  amountBeforeCents: number;
  amountAfterCents: number;
  stateBefore: string;
  stateAfter: string;
}

export interface PlannedCancel {
  receiptId: string;
  receiptNumber: string;
  contactName: string;
  totalAmountCents: number;
  hasPdf: boolean;
}

export interface PlannedReceiptLine {
  /** an existing contribution's id, or a `new:` ref to a replacement row */
  contributionRef: string;
  amountCents: number;
}

export interface PlannedReceipt {
  key: string;
  contactId: string;
  contactName: string;
  entityKind: EntityKind;
  ridingNumber: number | null;
  periodId: number;
  totalAmountCents: number;
  lines: PlannedReceiptLine[];
  replacesReceiptId: string | null;
  replacesReceiptNumber: string | null;
  /** the one `Receipt.replacedById` points at */
  primaryReplacement: boolean;
}

export interface PlannedOwedItem {
  kind: 'DC1A' | 'RETURN_NOTE';
  subjectType: 'Contribution' | 'Receipt';
  /** for a return note on a receipt that does not exist yet */
  subjectId: string | null;
  description: string;
}

export interface CorrectionPlan {
  action: CorrectionAction;
  changes: PlannedChange[];
  payments: PlannedPayment[];
  cancelReceipts: PlannedCancel[];
  issueReceipts: PlannedReceipt[];
  owedToEo: PlannedOwedItem[];
  /** generated entity reports the change makes stale (they regenerate; nothing is written here) */
  dirtyReports: { entityReportId: string; kind: string; periodId: number; filed: boolean }[];
  /** entities the caller must supply a "received by" label for */
  labelsNeeded: { entityKind: EntityKind; ridingNumber: number | null; key: string }[];
  /** non-blocking, e.g. "Qomon still shows ..." (corrections.md, "Qomon after a correction") */
  followUps: string[];
  blockers: string[];
}

type LoadedContribution = Contribution & {
  contact: Contact;
  payment: Payment & { qomonLink: { qomonTransactionId: bigint } | null };
  allocations: { id: string; receiptId: string; amountCents: number; receipt: { status: string } }[];
  rtdInclusions: { rtdFiling: { submittedAt: Date | null } }[];
};

export interface ReceiptForCorrection {
  id: string;
  receiptNumber: string;
  status: string;
  contactId: string;
  contactNameSnapshot: string;
  entityKind: EntityKind;
  ridingNumber: number | null;
  periodId: number;
  delivery: ReceiptDelivery;
  pdfArtifactId: string | null;
  pdfArtifact: { uri: string } | null;
  contact: Contact;
  allocations: {
    id: string;
    contributionId: string;
    amountCents: number;
    contribution: Contribution & { allocations: { receiptId: string; contributionId: string; amountCents: number; receipt: { status: string } }[] };
  }[];
  entityReportLinks: { entityReport: { id: string; kind: string; periodId: number; filedAt: Date | null; supersededById: string | null } }[];
}

interface Prepared {
  plan: CorrectionPlan;
  loaded: Map<string, LoadedContribution>;
  receipts: Map<string, ReceiptForCorrection>;
  contacts: Map<string, Contact>;
  paymentCorrection: { paymentId: string; amountCents: number } | null;
  paymentStates: Map<string, string>;
  rtdReported: Set<string>;
}

const REF_PREFIX = 'new:';

function spaceKey(contactId: string, entityKind: EntityKind, ridingNumber: number | null, periodId: number): string {
  return `${contactId}|${entityKind}|${ridingNumber ?? ''}|${periodId}`;
}

function labelKey(entityKind: EntityKind, ridingNumber: number | null): string {
  return `${entityKind}:${ridingNumber ?? ''}`;
}

function isReported(c: { rtdInclusions: { rtdFiling: { submittedAt: Date | null } }[] }): boolean {
  return c.rtdInclusions.some((i) => i.rtdFiling.submittedAt != null);
}

function resolveReplacement(
  old: LoadedContribution,
  spec: ReplacementSpec,
  contacts: Map<string, Contact>,
  ref: string,
  partCount: number,
): PlannedContribution {
  if (!Number.isInteger(spec.amountCents) || spec.amountCents <= 0) {
    throw new CorrectionValidationError('every replacement amount must be a positive whole number of cents');
  }
  const contactId = spec.contactId ?? old.contactId;
  const contact = contacts.get(contactId);
  if (!contact) throw new CorrectionValidationError(`no contact ${contactId}`);

  let nonDeductibleCents: number;
  if (spec.nonDeductibleCents !== undefined) {
    nonDeductibleCents = spec.nonDeductibleCents;
  } else if (old.nonDeductibleCents === 0) {
    nonDeductibleCents = 0;
  } else if (partCount === 1 && spec.amountCents === old.amountCents) {
    nonDeductibleCents = old.nonDeductibleCents;
  } else {
    throw new CorrectionValidationError(
      `contribution ${old.id} has a non-deductible amount; state the non-deductible amount of each replacement explicitly`,
    );
  }
  if (!Number.isInteger(nonDeductibleCents) || nonDeductibleCents < 0 || nonDeductibleCents > spec.amountCents) {
    throw new CorrectionValidationError('a non-deductible amount must be between 0 and the replacement amount');
  }

  return {
    ref,
    contactId,
    contactName: contact.name,
    amountCents: spec.amountCents,
    acceptedAt: spec.acceptedAt ?? old.acceptedAt,
    periodId: spec.periodId !== undefined ? spec.periodId : old.periodId,
    ridingNumber: spec.ridingNumber !== undefined ? spec.ridingNumber : old.ridingNumber,
    entityKind: spec.entityKind ?? old.entityKind,
    receivedBy: spec.receivedBy ?? old.receivedBy,
    goodsServices: spec.goodsServices ?? old.goodsServices,
    nonDeductibleCents,
    note: spec.note !== undefined ? spec.note : old.note,
  };
}

function receiptAddressBlocker(contact: Contact): string | null {
  const address = addressFrom(contact.addresses);
  const missing = [
    !address?.street && 'a street',
    !address?.city && 'a city',
    !address?.postalcode && 'a postal code',
  ].filter((f): f is string => f !== false);
  return missing.length > 0 ? `${contact.name} is missing ${missing.join(', ')} on their address on file` : null;
}

/** What a correction needs to know about a receipt it cancels. */
export const RECEIPT_CORRECTION_INCLUDE = {
  contact: true,
  pdfArtifact: true,
  allocations: {
    include: { contribution: { include: { allocations: { include: { receipt: { select: { status: true } } } } } } },
  },
  entityReportLinks: {
    include: { entityReport: { select: { id: true, kind: true, periodId: true, filedAt: true, supersededById: true } } },
  },
} as const;

/** What is still eligible on a contribution once the given receipt is treated
 *  as cancelled: the amount a replacement receipt may carry (invariant 1). */
export function remainingWithoutReceipt(
  c: ReceiptForCorrection['allocations'][number]['contribution'],
  excludedReceiptId: string,
): number {
  const others: AllocationRow[] = c.allocations
    .filter((x) => x.receiptId !== excludedReceiptId)
    .map((x) => ({
      receiptId: x.receiptId,
      contributionId: x.contributionId,
      amountCents: x.amountCents,
      receiptStatus: x.receipt.status as AllocationRow['receiptStatus'],
    }));
  return remainingEligibleCents({ id: c.id, amountCents: c.amountCents, nonDeductibleCents: c.nonDeductibleCents }, others);
}

type DirtyReport = CorrectionPlan['dirtyReports'][number];

/**
 * What cancelling some receipts and issuing others does beyond the receipts
 * themselves (shared with `receipt-split.ts`): return notes for anything inside
 * a filed return, the generated reports that go stale, and what stops the
 * issuance (kill switch, a donor with no printable address).
 */
export async function receiptCascadeEffects(
  prisma: PrismaClient,
  input: { cancelled: ReceiptForCorrection[]; issue: PlannedReceipt[]; contacts: Map<string, Contact> },
): Promise<{
  owedToEo: PlannedOwedItem[];
  dirtyReports: DirtyReport[];
  blockers: string[];
  labelsNeeded: CorrectionPlan['labelsNeeded'];
}> {
  const owedToEo: PlannedOwedItem[] = [];
  const dirty = new Map<string, DirtyReport>();
  const blockers: string[] = [];

  for (const receipt of input.cancelled) {
    for (const link of receipt.entityReportLinks) {
      const report = link.entityReport;
      if (report.supersededById) continue;
      dirty.set(report.id, {
        entityReportId: report.id,
        kind: report.kind,
        periodId: report.periodId,
        filed: report.filedAt != null,
      });
      if (report.filedAt != null) {
        owedToEo.push({
          kind: 'RETURN_NOTE',
          subjectType: 'Receipt',
          subjectId: receipt.id,
          description: `receipt ${receipt.receiptNumber} is in a filed ${report.kind} report: note the change in the current year's return`,
        });
      }
    }
  }

  for (const planned of input.issue) {
    const reports = await prisma.entityReport.findMany({
      where: {
        periodId: planned.periodId,
        supersededById: null,
        OR: [
          { entityKind: planned.entityKind, ridingNumber: planned.ridingNumber },
          { entityKind: null, ridingNumber: null },
        ],
      },
      select: { id: true, kind: true, periodId: true, filedAt: true },
    });
    for (const report of reports) {
      dirty.set(report.id, {
        entityReportId: report.id,
        kind: report.kind,
        periodId: report.periodId,
        filed: report.filedAt != null,
      });
    }
    if (reports.some((r) => r.filedAt != null)) {
      owedToEo.push({
        kind: 'RETURN_NOTE',
        subjectType: 'Receipt',
        subjectId: null,
        description: `a new receipt for ${planned.contactName} falls in a filed return: note it in the current year's return`,
      });
    }
  }

  if (input.issue.length > 0) {
    const killSwitch = await getKillSwitch(prisma);
    if (killSwitch.engaged) blockers.push('receipt issuance is disabled by the kill switch');
    for (const contactId of new Set(input.issue.map((r) => r.contactId))) {
      const contact = input.contacts.get(contactId) ?? (await prisma.contact.findUnique({ where: { id: contactId } }));
      if (!contact) continue;
      const blocker = receiptAddressBlocker(contact);
      if (blocker) blockers.push(blocker);
    }
  }

  const labelsNeeded = new Map<string, CorrectionPlan['labelsNeeded'][number]>();
  for (const r of input.issue) {
    const key = labelKey(r.entityKind, r.ridingNumber);
    labelsNeeded.set(key, { entityKind: r.entityKind, ridingNumber: r.ridingNumber, key });
  }

  return { owedToEo, dirtyReports: [...dirty.values()], blockers, labelsNeeded: [...labelsNeeded.values()] };
}

async function prepare(prisma: PrismaClient, input: CorrectionInput): Promise<Prepared> {
  if (input.changes.length === 0 && !input.inTransaction) {
    throw new CorrectionValidationError('a correction needs at least one change');
  }
  const ids = input.changes.map((c) => c.contributionId);
  if (new Set(ids).size !== ids.length) throw new CorrectionValidationError('a contribution can appear only once');

  const rows = (await prisma.contribution.findMany({
    where: { id: { in: ids } },
    include: {
      contact: true,
      payment: { include: { qomonLink: { select: { qomonTransactionId: true } } } },
      allocations: { include: { receipt: { select: { status: true } } } },
      rtdInclusions: { include: { rtdFiling: { select: { submittedAt: true } } } },
    },
  })) as LoadedContribution[];
  const loaded = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    const row = loaded.get(id);
    if (!row) throw new ContributionNotFoundError(id);
    if (row.status !== 'ACTIVE') throw new ContributionNotActiveError(id, row.status);
  }

  const contactIds = new Set<string>();
  for (const change of input.changes) {
    contactIds.add(loaded.get(change.contributionId)!.contactId);
    if (change.kind === 'supersede') {
      if (change.replacements.length === 0) {
        throw new CorrectionValidationError('a supersede needs at least one replacement');
      }
      for (const r of change.replacements) if (r.contactId) contactIds.add(r.contactId);
    }
  }
  const contactRows = await prisma.contact.findMany({ where: { id: { in: [...contactIds] } } });
  const contacts = new Map(contactRows.map((c) => [c.id, c]));
  for (const change of input.changes) {
    if (change.kind !== 'supersede') continue;
    for (const spec of change.replacements) {
      const target = spec.contactId ? contacts.get(spec.contactId) : undefined;
      if (target?.mergedIntoId) {
        throw new CorrectionValidationError(
          `contact ${target.name} was merged into contact ${target.mergedIntoId}; attribute to the surviving contact`,
        );
      }
    }
  }

  const plannedChanges: PlannedChange[] = input.changes.map((change, ci) => {
    const old = loaded.get(change.contributionId)!;
    const replacements =
      change.kind === 'supersede'
        ? change.replacements.map((spec, ri) =>
            resolveReplacement(old, spec, contacts, `${REF_PREFIX}${ci}:${ri}`, change.replacements.length),
          )
        : [];
    if (change.kind === 'supersede' && change.replacements.length > 1 && old.nonDeductibleCents > 0) {
      const total = replacements.reduce((sum, r) => sum + r.nonDeductibleCents, 0);
      if (total !== old.nonDeductibleCents) {
        throw new CorrectionValidationError(
          `the non-deductible amounts of the parts (${total}c) must add up to the original's (${old.nonDeductibleCents}c)`,
        );
      }
    }
    return {
      contributionId: old.id,
      kind: change.kind,
      before: {
        contactId: old.contactId,
        contactName: old.contact.name,
        amountCents: old.amountCents,
        acceptedAt: old.acceptedAt,
        periodId: old.periodId,
        ridingNumber: old.ridingNumber,
        entityKind: old.entityKind,
      },
      replacements,
    };
  });

  // --- payments: invariant 1 on the payment, state after a refund ---------
  const paymentIds = [...new Set(rows.map((r) => r.paymentId))];
  const paymentCorrection = input.paymentAmountCorrection ?? null;
  if (paymentCorrection && !paymentIds.includes(paymentCorrection.paymentId)) {
    throw new CorrectionValidationError('a payment amount can be corrected only for a payment this action touches');
  }
  if (paymentCorrection && (!Number.isInteger(paymentCorrection.amountCents) || paymentCorrection.amountCents <= 0)) {
    throw new CorrectionValidationError('the corrected payment amount must be a positive whole number of cents');
  }
  const plannedPayments: PlannedPayment[] = [];
  const paymentStates = new Map<string, string>();
  for (const paymentId of paymentIds) {
    const payment = rows.find((r) => r.paymentId === paymentId)!.payment;
    const activeSiblings = await prisma.contribution.findMany({
      where: { paymentId, status: 'ACTIVE' },
      select: { id: true, amountCents: true },
    });
    const changedOnPayment = plannedChanges.filter((c) => loaded.get(c.contributionId)!.paymentId === paymentId);
    const changedIds = new Set(changedOnPayment.map((c) => c.contributionId));
    const remainingActive = activeSiblings.filter((s) => !changedIds.has(s.id));
    const afterCents =
      remainingActive.reduce((sum, s) => sum + s.amountCents, 0) +
      changedOnPayment.reduce((sum, c) => sum + c.replacements.reduce((s2, r) => s2 + r.amountCents, 0), 0);
    const amountAfter = paymentCorrection?.paymentId === paymentId ? paymentCorrection.amountCents : payment.amountCents;
    if (afterCents > amountAfter) throw new PaymentSumExceededError(paymentId, afterCents, amountAfter);

    const noneActiveAfter =
      remainingActive.length === 0 && changedOnPayment.every((c) => c.replacements.length === 0);
    const stateAfter =
      noneActiveAfter && changedOnPayment.some((c) => c.kind === 'refund') && payment.state === 'RECEIVED'
        ? 'REFUNDED'
        : payment.state;
    paymentStates.set(paymentId, stateAfter);
    if (amountAfter !== payment.amountCents || stateAfter !== payment.state) {
      plannedPayments.push({
        paymentId,
        amountBeforeCents: payment.amountCents,
        amountAfterCents: amountAfter,
        stateBefore: payment.state,
        stateAfter,
      });
    }
  }

  // --- receipts -----------------------------------------------------------
  const changedIds = new Set(ids);
  const affectedReceiptIds = new Set<string>();
  for (const row of rows) {
    for (const a of row.allocations) if (a.receipt.status === 'ISSUED') affectedReceiptIds.add(a.receiptId);
  }
  const receiptRows = (await prisma.receipt.findMany({
    where: { id: { in: [...affectedReceiptIds] } },
    orderBy: [{ issueDate: 'asc' }, { receiptNumber: 'asc' }],
    include: RECEIPT_CORRECTION_INCLUDE,
  })) as unknown as ReceiptForCorrection[];
  const receipts = new Map(receiptRows.map((r) => [r.id, r]));

  const blockers: string[] = [];
  const cancelReceipts: PlannedCancel[] = [];
  const issueReceipts: PlannedReceipt[] = [];
  const owedToEo: PlannedOwedItem[] = [];
  const claimed = new Set<string>();
  const changeByContribution = new Map(plannedChanges.map((c) => [c.contributionId, c]));

  for (const receipt of receiptRows) {
    cancelReceipts.push({
      receiptId: receipt.id,
      receiptNumber: receipt.receiptNumber,
      contactName: receipt.contactNameSnapshot,
      totalAmountCents: receipt.allocations.reduce((sum, a) => sum + a.amountCents, 0),
      hasPdf: receipt.pdfArtifactId != null,
    });

    const groups = new Map<string, PlannedReceipt>();
    const addLine = (
      contactId: string,
      contactName: string,
      entityKind: EntityKind,
      ridingNumber: number | null,
      periodId: number | null,
      line: PlannedReceiptLine,
    ) => {
      if (periodId === null) {
        blockers.push(`${contactName}: a replacement has no reporting period, so it cannot be receipted`);
        return;
      }
      const key = spaceKey(contactId, entityKind, ridingNumber, periodId);
      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          contactId,
          contactName,
          entityKind,
          ridingNumber,
          periodId,
          totalAmountCents: 0,
          lines: [],
          replacesReceiptId: contactId === receipt.contactId ? receipt.id : null,
          replacesReceiptNumber: contactId === receipt.contactId ? receipt.receiptNumber : null,
          primaryReplacement: false,
        };
        groups.set(key, group);
      }
      group.lines.push(line);
      group.totalAmountCents += line.amountCents;
    };

    // what the receipt covered and nothing is changing about
    for (const a of receipt.allocations) {
      const c = a.contribution;
      if (changedIds.has(c.id) || c.status !== 'ACTIVE' || c.periodId === null) continue;
      const remaining = remainingWithoutReceipt(c, receipt.id);
      if (remaining > 0) {
        addLine(receipt.contactId, receipt.contact.name, c.entityKind, c.ridingNumber, c.periodId, {
          contributionRef: c.id,
          amountCents: remaining,
        });
      }
    }
    // what replaces the retired contributions
    for (const a of receipt.allocations) {
      const change = changeByContribution.get(a.contributionId);
      if (!change) continue;
      for (const r of change.replacements) {
        if (claimed.has(r.ref)) continue;
        claimed.add(r.ref);
        const eligible = r.amountCents - r.nonDeductibleCents;
        if (eligible <= 0) continue;
        addLine(r.contactId, r.contactName, r.entityKind, r.ridingNumber, r.periodId, {
          contributionRef: r.ref,
          amountCents: eligible,
        });
      }
    }

    const sameContact = [...groups.values()].filter((g) => g.replacesReceiptId !== null);
    const primary =
      sameContact.find((g) => g.key === spaceKey(receipt.contactId, receipt.entityKind, receipt.ridingNumber, receipt.periodId)) ??
      sameContact[0];
    if (primary) primary.primaryReplacement = true;
    issueReceipts.push(...groups.values());
  }

  // --- what EO has already seen -------------------------------------------
  for (const change of plannedChanges) {
    const old = loaded.get(change.contributionId)!;
    if (isReported(old)) {
      owedToEo.push({
        kind: 'DC1A',
        subjectType: 'Contribution',
        subjectId: old.id,
        description: `contribution ${old.id} was RTD-reported: a DC-1A amendment is owed`,
      });
    }
  }
  const effects = await receiptCascadeEffects(prisma, { cancelled: receiptRows, issue: issueReceipts, contacts });
  owedToEo.push(...effects.owedToEo);
  blockers.push(...effects.blockers);

  const followUps: string[] = [];
  for (const change of plannedChanges) {
    const old = loaded.get(change.contributionId)!;
    const link = old.payment.qomonLink;
    if (!link) continue;
    const differs =
      change.kind === 'refund' ||
      change.replacements.some((r) => r.contactId !== old.contactId || r.amountCents !== old.amountCents);
    if (differs) {
      followUps.push(
        `Qomon still shows transaction ${link.qomonTransactionId} as ${old.contact.name}, ` +
          `${(old.amountCents / 100).toFixed(2)}; fix it by hand if Fundraising needs it (the tool never writes to Qomon)`,
      );
    }
  }

  followUps.push(...(input.extraFollowUps ?? []));

  const plan: CorrectionPlan = {
    action: input.action,
    changes: plannedChanges,
    payments: plannedPayments,
    cancelReceipts,
    issueReceipts,
    owedToEo,
    dirtyReports: effects.dirtyReports,
    labelsNeeded: effects.labelsNeeded,
    followUps,
    blockers: [...new Set(blockers)],
  };

  return {
    plan,
    loaded,
    receipts,
    contacts,
    paymentCorrection,
    paymentStates,
    rtdReported: new Set(rows.filter(isReported).map((r) => r.id)),
  };
}

/** The whole cascade, computed and not committed (corrections.md principle 2). */
export async function previewCorrection(prisma: PrismaClient, input: CorrectionInput): Promise<CorrectionPlan> {
  return (await prepare(prisma, input)).plan;
}

export interface CorrectionResult {
  correlationId: string;
  supersededContributionIds: string[];
  refundedContributionIds: string[];
  createdContributionIds: string[];
  cancelledReceiptIds: string[];
  issuedReceipts: { id: string; receiptNumber: string; contactId: string; amountCents: number; replacesReceiptId: string | null }[];
  cancellationNoticeArtifactIds: string[];
  owedToEoWorkItemIds: string[];
  followUps: string[];
  /** replacements whose post-commit validation run failed (the correction itself is committed) */
  validationFailures: string[];
}

const SEQUENCE_PREFIX = 'GPO-';

// ---------------------------------------------------------------------------
// Receipt cascade steps, shared with `receipt-split.ts`
// ---------------------------------------------------------------------------

/** Cancellation notices are rendered before the transaction (they only read
 *  the original PDF), the same order `cancelReceipt` uses. */
export async function renderCancellationNotices(
  deps: ArtifactStoreDeps,
  receipts: { id: string; pdfArtifact: { uri: string } | null }[],
): Promise<Map<string, string>> {
  const artifactIds = new Map<string, string>();
  for (const receipt of receipts) {
    if (!receipt.pdfArtifact) continue;
    const original = await readFile(path.join(deps.storageDir, receipt.pdfArtifact.uri));
    const artifact = await storeArtifact(deps, {
      kind: 'PDF',
      bytes: await renderCancellationNoticePdf(original),
      extension: 'pdf',
    });
    artifactIds.set(receipt.id, artifact.id);
  }
  return artifactIds;
}

export async function cancelReceiptsInTx(
  ctx: ChangeLogContext,
  receipts: { id: string; status: string }[],
  noticeArtifactIds: Map<string, string>,
): Promise<void> {
  for (const receipt of receipts) {
    const after = await ctx.tx.receipt.update({ where: { id: receipt.id }, data: { status: 'CANCELLED' } });
    await ctx.log({
      subjectType: 'Receipt',
      subjectId: receipt.id,
      before: { status: receipt.status },
      after: { status: after.status },
    });
    const artifactId = noticeArtifactIds.get(receipt.id);
    if (artifactId) {
      const eoForm = await ctx.tx.eOForm.create({
        data: { kind: 'CANCELLATION', subject: 'receipt', receiptId: receipt.id, artifactId },
      });
      await ctx.log({
        subjectType: 'Receipt',
        subjectId: receipt.id,
        after: { cancellationNoticeArtifactId: artifactId, eoFormId: eoForm.id },
      });
    }
  }
}

export interface IssuedInTx {
  planned: PlannedReceipt;
  receipt: { id: string; receiptNumber: string; issueDate: Date };
  address: NonNullable<ReturnType<typeof addressFrom>>;
  addressLine1: string;
}

/** Issues one planned receipt: address snapshot, next sequence number, the
 *  receipt and its allocations, and the primary replacement link. */
export async function issuePlannedInTx(
  ctx: ChangeLogContext,
  planned: PlannedReceipt,
  opts: {
    contacts: Map<string, Contact>;
    replaced: Map<string, { delivery: ReceiptDelivery }>;
    delivery?: ReceiptDelivery;
    /** resolves a `new:` line ref to the contribution row it created */
    resolveRef: (ref: string) => string;
  },
): Promise<IssuedInTx> {
  const { tx } = ctx;
  const contact = opts.contacts.get(planned.contactId) ?? (await tx.contact.findUniqueOrThrow({ where: { id: planned.contactId } }));
  const address = addressFrom(contact.addresses)!;
  const addressLine1 = [address.housenumber, address.street].filter(Boolean).join(' ');
  const snapshot = await tx.addressSnapshot.create({
    data: {
      contactId: contact.id,
      periodId: planned.periodId,
      line1: addressLine1 || 'unknown',
      city: address.city!,
      province: address.state ?? 'ON',
      postalCode: address.postalcode!,
      country: address.country ?? 'CA',
      source: 'correction',
    },
  });
  await ctx.log({ subjectType: 'AddressSnapshot', subjectId: snapshot.id, after: snapshot });

  const seq = await tx.receiptSequence.update({
    where: { prefix: SEQUENCE_PREFIX },
    data: { counter: { increment: 1 } },
  });
  const receiptNumber = formatReceiptNumber(SEQUENCE_PREFIX, seq.counter);
  const source = planned.replacesReceiptId ? opts.replaced.get(planned.replacesReceiptId) : undefined;
  const receipt = await tx.receipt.create({
    data: {
      receiptNumber,
      numberSource: 'SEQUENCE',
      entityKind: planned.entityKind,
      ridingNumber: planned.ridingNumber,
      periodId: planned.periodId,
      issueDate: new Date(),
      contactId: contact.id,
      contactNameSnapshot: contact.name,
      addressSnapshotId: snapshot.id,
      delivery: opts.delivery ?? source?.delivery ?? 'MAIL',
      reissuedFromId: planned.replacesReceiptId,
    },
  });
  await ctx.log({
    subjectType: 'Receipt',
    subjectId: receipt.id,
    after: { receiptNumber, reissuedFromId: planned.replacesReceiptId },
  });
  for (const line of planned.lines) {
    const allocation = await tx.receiptAllocation.create({
      data: { receiptId: receipt.id, contributionId: opts.resolveRef(line.contributionRef), amountCents: line.amountCents },
    });
    await ctx.log({ subjectType: 'ReceiptAllocation', subjectId: allocation.id, after: allocation });
  }
  if (planned.primaryReplacement && planned.replacesReceiptId) {
    const old = await tx.receipt.update({
      where: { id: planned.replacesReceiptId },
      data: { replacedById: receipt.id },
    });
    await ctx.log({
      subjectType: 'Receipt',
      subjectId: old.id,
      before: { replacedById: null },
      after: { replacedById: receipt.id },
    });
  }
  return { planned, receipt, address, addressLine1 };
}

/** Renders each newly issued receipt's PDF and attaches it in a second write
 *  under the correction's correlation id. The first contribution on the
 *  receipt stands in for the printed date and goods-and-services flag on a
 *  multi-line receipt (O44 is still open, same as `reissueReceipt`). */
export async function attachIssuedPdfs(
  deps: ArtifactStoreDeps,
  issued: IssuedInTx[],
  opts: {
    actorUserId: string;
    reason: string;
    correlationId: string;
    labelFor: (entityKind: EntityKind, ridingNumber: number | null) => string;
    contributionFor: (ref: string) => Promise<Contribution>;
  },
): Promise<CorrectionResult['issuedReceipts']> {
  const out: CorrectionResult['issuedReceipts'] = [];
  for (const { planned, receipt, address, addressLine1 } of issued) {
    const primary = await opts.contributionFor(planned.lines[0]!.contributionRef);
    const pdfBytes = await renderReceiptPdf({
      receiptNumber: receipt.receiptNumber,
      issueDate: receipt.issueDate,
      acceptedAt: primary.acceptedAt,
      eligibleAmountCents: planned.totalAmountCents,
      isGoodsServices: primary.goodsServices,
      politicalEntityLabel: opts.labelFor(planned.entityKind, planned.ridingNumber),
      eoContributorId: primary.eoContributorId,
      contributorName: planned.contactName,
      replacesReceiptNumber: planned.replacesReceiptNumber,
      addressLine1,
      addressLine2: null,
      city: address.city!,
      province: address.state ?? 'ON',
      postalCode: address.postalcode!,
      country: address.country ?? 'CA',
    });
    const artifact = await storeArtifact(deps, { kind: 'PDF', bytes: pdfBytes, extension: 'pdf' });
    await withChangeLog(
      deps.prisma,
      { userId: opts.actorUserId, reason: opts.reason, correlationId: opts.correlationId },
      async (ctx) => {
        await ctx.tx.receipt.update({ where: { id: receipt.id }, data: { pdfArtifactId: artifact.id } });
        await ctx.log({ subjectType: 'Receipt', subjectId: receipt.id, after: { pdfArtifactId: artifact.id } });
      },
    );
    out.push({
      id: receipt.id,
      receiptNumber: receipt.receiptNumber,
      contactId: planned.contactId,
      amountCents: planned.totalAmountCents,
      replacesReceiptId: planned.replacesReceiptId,
    });
  }
  return out;
}

/** A return note for each new receipt that lands in a space whose return was
 *  already filed. */
export async function openReturnNotesForNewReceipts(ctx: ChangeLogContext, issued: IssuedInTx[]): Promise<string[]> {
  const ids: string[] = [];
  for (const { planned, receipt } of issued) {
    const filed = await ctx.tx.entityReport.count({
      where: {
        periodId: planned.periodId,
        filedAt: { not: null },
        supersededById: null,
        OR: [
          { entityKind: planned.entityKind, ridingNumber: planned.ridingNumber },
          { entityKind: null, ridingNumber: null },
        ],
      },
    });
    if (filed > 0) {
      ids.push(
        await openOwedToEo(ctx, {
          subjectType: 'Receipt',
          subjectId: receipt.id,
          contactId: planned.contactId,
          ruleRef: OWED_RETURN_NOTE,
        }),
      );
    }
  }
  return ids;
}

export async function applyCorrection(deps: ArtifactStoreDeps, input: CorrectionInput): Promise<CorrectionResult> {
  const { prisma } = deps;
  const prepared = await prepare(prisma, input);
  const { plan, loaded, receipts, contacts } = prepared;
  if (plan.blockers.length > 0) throw new CorrectionBlockedError(plan.blockers);

  const labelFor = labelResolver(input);
  for (const r of plan.issueReceipts) labelFor(r.entityKind, r.ridingNumber);

  const noticeArtifactIds = await renderCancellationNotices(
    deps,
    plan.cancelReceipts.map((c) => receipts.get(c.receiptId)!),
  );

  const correlationId = randomUUID();
  const supersededContributionIds: string[] = [];
  const refundedContributionIds: string[] = [];
  const createdByRef = new Map<string, Contribution>();
  const owedToEoWorkItemIds: string[] = [];
  const issued: IssuedInTx[] = [];

  await withChangeLog(
    prisma,
    { userId: input.actorUserId, reason: input.reason, correlationId },
    async (ctx) => {
      const { tx } = ctx;

      // 1. payments and contributions
      for (const p of plan.payments) {
        const before = await tx.payment.findUniqueOrThrow({ where: { id: p.paymentId } });
        const after = await tx.payment.update({
          where: { id: p.paymentId },
          data: { amountCents: p.amountAfterCents, state: p.stateAfter as Payment['state'] },
        });
        await ctx.log({
          subjectType: 'Payment',
          subjectId: p.paymentId,
          before: { amountCents: before.amountCents, state: before.state },
          after: { amountCents: after.amountCents, state: after.state },
        });
      }
      for (const change of plan.changes) {
        const old = loaded.get(change.contributionId)!;
        for (const r of change.replacements) {
          const created = await tx.contribution.create({
            data: {
              paymentId: old.paymentId,
              contactId: r.contactId,
              amountCents: r.amountCents,
              acceptedAt: r.acceptedAt,
              supersedesId: old.id,
              correlationId,
              note: r.note,
              periodId: r.periodId,
              ridingNumber: r.ridingNumber,
              entityKind: r.entityKind,
              receivedBy: r.receivedBy,
              goodsServices: r.goodsServices,
              nonDeductibleCents: r.nonDeductibleCents,
              processedDate: old.processedDate,
              sourceCode: old.sourceCode,
              // an EO contributor id belongs to the donor, and an exception
              // was granted to this row's facts: neither carries to a
              // different contact or a corrected row
              eoContributorId: r.contactId === old.contactId ? old.eoContributorId : null,
              exceptionReason: null,
              createdByUserId: input.actorUserId,
            },
          });
          createdByRef.set(r.ref, created);
          await ctx.log({ subjectType: 'Contribution', subjectId: created.id, after: created });
        }
        const status = change.kind === 'supersede' ? 'SUPERSEDED' : 'REFUNDED';
        const after = await tx.contribution.update({ where: { id: old.id }, data: { status } });
        await ctx.log({
          subjectType: 'Contribution',
          subjectId: old.id,
          before: { status: old.status },
          after: { status: after.status },
        });
        (change.kind === 'supersede' ? supersededContributionIds : refundedContributionIds).push(old.id);

        // an open finding on a retired row is history
        const open = await tx.workItem.findMany({
          where: {
            subjectType: 'Contribution',
            subjectId: old.id,
            status: 'OPEN',
            kind: { in: ['VALIDATION', 'DIFF'] },
          },
        });
        for (const item of open) {
          const closed = await tx.workItem.update({
            where: { id: item.id },
            data: {
              status: 'RESOLVED',
              closedAt: new Date(),
              resolutionNote: `closed by a correction: ${old.id} is now ${status}`,
            },
          });
          await ctx.log({
            subjectType: 'WorkItem',
            subjectId: item.id,
            before: { status: item.status },
            after: { status: closed.status, resolutionNote: closed.resolutionNote },
          });
        }
      }

      await input.inTransaction?.(ctx);

      // 2. cancel the affected receipts, 3. issue the replacements
      await cancelReceiptsInTx(
        ctx,
        plan.cancelReceipts.map((c) => receipts.get(c.receiptId)!),
        noticeArtifactIds,
      );
      const resolveRef = (ref: string) => (ref.startsWith(REF_PREFIX) ? createdByRef.get(ref)!.id : ref);
      for (const planned of plan.issueReceipts) {
        issued.push(await issuePlannedInTx(ctx, planned, { contacts, replaced: receipts, delivery: input.delivery, resolveRef }));
      }

      // 4. what EO must still be told
      for (const item of plan.owedToEo) {
        if (item.kind === 'DC1A') {
          const c = loaded.get(item.subjectId!)!;
          owedToEoWorkItemIds.push(
            await openOwedToEo(ctx, {
              subjectType: 'Contribution',
              subjectId: c.id,
              contactId: c.contactId,
              ruleRef: OWED_DC1A,
            }),
          );
        } else if (item.subjectId) {
          const r = receipts.get(item.subjectId)!;
          owedToEoWorkItemIds.push(
            await openOwedToEo(ctx, {
              subjectType: 'Receipt',
              subjectId: r.id,
              contactId: r.contactId,
              ruleRef: OWED_RETURN_NOTE,
            }),
          );
        }
      }
      owedToEoWorkItemIds.push(...(await openReturnNotesForNewReceipts(ctx, issued)));
    },
  );

  // 5. PDFs for the new receipts, attached in a second write under the same correlation id
  const issuedReceipts = await attachIssuedPdfs(deps, issued, {
    actorUserId: input.actorUserId,
    reason: input.reason,
    correlationId,
    labelFor,
    contributionFor: async (ref) =>
      ref.startsWith(REF_PREFIX)
        ? createdByRef.get(ref)!
        : (loaded.get(ref) ?? (await prisma.contribution.findUniqueOrThrow({ where: { id: ref } }))),
  });

  // 6. validate the replacements (the correction is already committed)
  const validationFailures: string[] = [];
  for (const created of createdByRef.values()) {
    try {
      await runValidationForContribution(prisma, created.id);
    } catch (err) {
      validationFailures.push(`${created.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    correlationId,
    supersededContributionIds,
    refundedContributionIds,
    createdContributionIds: [...createdByRef.values()].map((c) => c.id),
    cancelledReceiptIds: plan.cancelReceipts.map((c) => c.receiptId),
    issuedReceipts,
    cancellationNoticeArtifactIds: [...noticeArtifactIds.values()],
    owedToEoWorkItemIds,
    followUps: plan.followUps,
    validationFailures,
  };
}

/** The "received by" wording for an entity: the per-entity override, else the
 *  default; throws when neither exists, so a missing label fails before any write. */
export function labelResolver(input: {
  politicalEntityLabel?: string;
  entityLabels?: Record<string, string>;
}): (entityKind: EntityKind, ridingNumber: number | null) => string {
  return (entityKind, ridingNumber) => {
    const label = input.entityLabels?.[labelKey(entityKind, ridingNumber)] ?? input.politicalEntityLabel;
    if (!label) {
      throw new CorrectionValidationError(
        `a politicalEntityLabel is required: this correction issues a receipt for ${entityKind}${ridingNumber ? ` ${ridingNumber}` : ''}`,
      );
    }
    return label;
  };
}
