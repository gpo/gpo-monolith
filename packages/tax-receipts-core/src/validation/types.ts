import type { EntityKind, ReceivedBy } from '../enums.js';

/**
 * Shared shapes for the validation rule registry (ticket 1.7,
 * validation-rules.md). Split from rules.ts so api-layer callers can import
 * just the types without pulling in every rule implementation.
 */

export interface ValidationFinding {
  /** validation-rules.md rule id, e.g. "A1", "B2". */
  ruleRef: string;
  message: string;
}

export interface ContributionMetadataForValidation {
  periodId: number;
  ridingNumber: number | null;
  entityKind: EntityKind;
  receivedBy: ReceivedBy;
  goodsServices: boolean;
  nonDeductibleCents: number;
  sourceCode: string;
}

export interface ContributionForValidationRules {
  id: string;
  amountCents: number;
  acceptedAt: Date;
  paymentMethodKind: string | null;
  externalRef: string | null;
  metadata: ContributionMetadataForValidation;
}
