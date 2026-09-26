import { z } from 'zod';

/**
 * Domain enums. These are the canonical string unions; the Prisma schema
 * mirrors them as native Postgres enums with the same members. Keep the two
 * in sync (there is a test in the api package that asserts it).
 */

export const EntityKind = z.enum(['CA', 'CAMPAIGN', 'PARTY']);
export type EntityKind = z.infer<typeof EntityKind>;

/** Who physically received the money (data-model §2, invariant 8). */
export const ReceivedBy = z.enum(['GPO', 'ENTITY']);
export type ReceivedBy = z.infer<typeof ReceivedBy>;

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

/**
 * Application roles (stakeholders.md "What this implies for the tool").
 * CASL policies key off role plus per-riding grants (data-model §2 User).
 */
export const UserRole = z.enum([
  'sysadmin', // technology (Ian): full config + user admin
  'party_cfo', // Mike Bumby: the only role that may issue receipts (s. 25.1(6))
  'administrator', // Ariel: day-to-day contribution + receipt work
  'rules_authority', // Craig: eligibility calls, moves, non-deductible, cover letter
  'bookkeeper', // Judy: reconciliation, S2P2, auditor liaison
  'filer', // Lori/Caren: submit reports and forms to EO
  'process_owner', // Nicolle: oversight, "who has done what"
  'organizer', // Matt/AK/Stephanie: CFO liaison
  'cfo', // external CA/campaign CFO: sees only their entity (future)
  'readonly',
]);
export type UserRole = z.infer<typeof UserRole>;

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
]);
export type ChangeLogSubjectType = z.infer<typeof ChangeLogSubjectType>;
