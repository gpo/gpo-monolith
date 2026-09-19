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

/** Structurally matches `FormattedAddress`
 *  (apps/tax-receipts/api/src/contacts/address.ts) so callers can pass that
 *  straight through — this package has no dependency on qomon-client, so it
 *  can't import the type, only its shape. No `line2`: `formatAddress`
 *  doesn't expose one (it folds housenumber+street into `line1`). */
export interface AddressForValidation {
  line1: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
}
