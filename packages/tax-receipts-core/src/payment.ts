import type { PaymentMethod, PaymentState } from './enums.js';

/**
 * Maps Qomon's transaction vocabulary onto the tool's own payment enums
 * (data-model §2 Payment, D12). Import-time only: after a payment exists it
 * carries the tool's values, and the raw Qomon strings stay on the
 * QomonTransactionLink for provenance.
 */

/** Qomon's `payment_method_kind` codes as the sandbox allows them (open-
 *  questions.md O29: `[CB CBTPE CHE PRE VIR ESP]`, French-derived), plus the
 *  English examples in the published spec. Compared case-insensitively. */
const QOMON_METHOD: Record<string, PaymentMethod> = {
  cb: 'CARD',
  cbtpe: 'CARD',
  card: 'CARD',
  che: 'CHEQUE',
  check: 'CHEQUE',
  cheque: 'CHEQUE',
  pre: 'PAD',
  vir: 'EFT',
  transfer: 'EFT',
  esp: 'CASH',
  cash: 'CASH',
};

export function paymentMethodFromQomon(kind: string | null | undefined): PaymentMethod {
  if (kind == null) return 'OTHER';
  return QOMON_METHOD[kind.trim().toLowerCase()] ?? 'OTHER';
}

/** Qomon transaction status `kind` (qomon-api-reference §1.7). Anything
 *  outside the documented enum (the sandbox also returns e.g. `cancel`,
 *  O29) resolves to OTHER rather than failing an import. */
const QOMON_STATE: Record<string, PaymentState> = {
  valid: 'RECEIVED',
  unpaid: 'UNPAID',
  reimbursed: 'REFUNDED',
  bank_error: 'BANK_ERROR',
  other: 'OTHER',
};

export function paymentStateFromQomonKind(kind: string | null | undefined): PaymentState {
  if (kind == null) return 'OTHER';
  return QOMON_STATE[kind] ?? 'OTHER';
}
