import { z } from 'zod';

/**
 * Domain enums. These are the canonical string unions; the Prisma schema
 * mirrors them as native Postgres enums with the same members. Keep the two
 * in sync (there is a test in the api package that asserts it).
 */

/** Who a contribution is directed to (EO evaluation row 25): a
 *  constituency association, a campaign, the party, or a leadership
 *  contestant. CA and CAMPAIGN are riding-scoped; PARTY and LEADERSHIP carry
 *  no riding, and a LEADERSHIP contribution names its contestant instead. */
export const EntityKind = z.enum(['CA', 'CAMPAIGN', 'PARTY', 'LEADERSHIP']);
export type EntityKind = z.infer<typeof EntityKind>;

/** Whether an entity kind is tied to a riding (CA, CAMPAIGN) rather than
 *  province-wide (PARTY, LEADERSHIP). */
export function isRidingScoped(entityKind: EntityKind): boolean {
  return entityKind === 'CA' || entityKind === 'CAMPAIGN';
}

/** Who physically received the money (data-model §2, invariant 8). */
export const ReceivedBy = z.enum(['GPO', 'ENTITY']);
export type ReceivedBy = z.infer<typeof ReceivedBy>;

/** The kind of contributor (EO evaluation row 23). Ontario accepts political
 *  contributions from individuals only, so this has one member; it is a
 *  recorded field rather than an assumption so the record says so, and it
 *  matches the ALL report's `Contributor_Type` of `I`. */
export const ContributorType = z.enum(['INDIVIDUAL']);
export type ContributorType = z.infer<typeof ContributorType>;

export const ReceiptStatus = z.enum(['ISSUED', 'CANCELLED', 'VOID']);
export type ReceiptStatus = z.infer<typeof ReceiptStatus>;

export const ReceiptDelivery = z.enum(['EMAIL', 'MAIL']);
export type ReceiptDelivery = z.infer<typeof ReceiptDelivery>;

/** How a receipt number was obtained. FOREIGN rows are excluded from the
 *  sequence invariants (data-model §2, ticket 3.8). */
export const ReceiptNumberSource = z.enum(['SEQUENCE', 'FOREIGN']);
export type ReceiptNumberSource = z.infer<typeof ReceiptNumberSource>;

export const PeriodKind = z.enum(['ANNUAL', 'GENERAL_ELECTION', 'BY_ELECTION']);
export type PeriodKind = z.infer<typeof PeriodKind>;

/**
 * Contribution-limit buckets (compliance.md, O15). This list is NOT the
 * source of truth for which buckets exist in a given year: that is the
 * ContributionLimit table. It only enumerates the buckets the tool knows
 * how to attribute a contribution to.
 */
export const ContributionLimitBucket = z.enum([
  'PARTY',
  'CA',
  'CAMPAIGN',
  'LEADERSHIP',
  'CANDIDATE_SELF',
]);
export type ContributionLimitBucket = z.infer<typeof ContributionLimitBucket>;

/** Why a receipt's PDF was reproduced without cancelling it (corrections.md action 3). */
export const ReceiptReprintKind = z.enum(['LOST_COPY', 'CORRECTED']);
export type ReceiptReprintKind = z.infer<typeof ReceiptReprintKind>;

/** Where a payment came from (data-model §2, D12). */
export const PaymentSource = z.enum(['QOMON_IMPORT', 'MANUAL', 'LEGACY_IMPORT']);
export type PaymentSource = z.infer<typeof PaymentSource>;

/** How the money arrived. Qomon's payment-method codes map onto this at
 *  import (`paymentMethodFromQomon`); anything unrecognized is OTHER. */
export const PaymentMethod = z.enum(['CARD', 'CHEQUE', 'CASH', 'PAD', 'EFT', 'IN_KIND', 'OTHER']);
export type PaymentMethod = z.infer<typeof PaymentMethod>;

/** Whether the money actually landed. Only RECEIVED counts toward RTD
 *  disclosure and receipting (open-questions.md O42). Mapped from Qomon's
 *  transaction status `kind` at import (`paymentStateFromQomonKind`). */
export const PaymentState = z.enum(['RECEIVED', 'UNPAID', 'REFUNDED', 'BANK_ERROR', 'OTHER']);
export type PaymentState = z.infer<typeof PaymentState>;

/** Contribution lifecycle (corrections.md "Contribution lifecycle", D12):
 *  a correction closes a row as SUPERSEDED and opens its replacements. */
export const ContributionStatus = z.enum(['ACTIVE', 'SUPERSEDED', 'REFUNDED']);
export type ContributionStatus = z.infer<typeof ContributionStatus>;

export const WorkItemKind = z.enum([
  'VALIDATION',
  'DIFF',
  'OWED_TO_EO',
  'SYNC_INCIDENT',
  'DELIVERY',
]);
export type WorkItemKind = z.infer<typeof WorkItemKind>;

export const WorkItemStatus = z.enum(['OPEN', 'RESOLVED', 'EXCEPTION']);
export type WorkItemStatus = z.infer<typeof WorkItemStatus>;

export const RtdFilingKind = z.enum(['INITIAL', 'DC1A_AMENDMENT']);
export type RtdFilingKind = z.infer<typeof RtdFilingKind>;

export const RtdFilingFormat = z.enum(['CSV', 'PIPE']);
export type RtdFilingFormat = z.infer<typeof RtdFilingFormat>;

export const EntityReportKind = z.enum(['ALL', 'S2P2']);
export type EntityReportKind = z.infer<typeof EntityReportKind>;

export const EOFormKind = z.enum(['CANCELLATION', 'DC1', 'DC1A', 'OTHER']);
export type EOFormKind = z.infer<typeof EOFormKind>;

export const ArtifactKind = z.enum(['PDF', 'CSV', 'FORM']);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

export const ReconciliationMarkKind = z.enum([
  'PAYOUT',
  'BANK_DEPOSIT',
  'TRANSFER',
]);
export type ReconciliationMarkKind = z.infer<typeof ReconciliationMarkKind>;

/** The W6 space ladder (data-model §2 SpaceState). */
export const SpaceStage = z.enum([
  'intake',
  'queue-clear',
  'reconciled',
  'issued',
  'delivered',
  'reported',
  'sent-to-cfo',
]);
export type SpaceStage = z.infer<typeof SpaceStage>;

export const ChangeLogSubjectType = z.enum([
  'Payment',
  'Contribution',
  'ContributionMetadata',
  'Contact',
  'AddressSnapshot',
  'Receipt',
  'ReceiptAllocation',
  'RtdFiling',
  'RtdInclusion',
  'EntityReport',
  'EOForm',
  'WorkItem',
  'Period',
  'ContributionLimit',
  'DonorCyclePreference',
  'SpaceState',
  'ReconciliationMark',
  'User',
  'IssuanceKillSwitch',
  'EmailDeliverySettings',
  'Role',
  'LeadershipContestant',
  'ReceiptSettings',
]);
export type ChangeLogSubjectType = z.infer<typeof ChangeLogSubjectType>;
