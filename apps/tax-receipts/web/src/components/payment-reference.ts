import type { PaymentMethodKey } from '../api.js';

export const PAYMENT_METHODS: Array<{ value: PaymentMethodKey; label: string }> = [
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'CARD', label: 'Card' },
  { value: 'CASH', label: 'Cash' },
  { value: 'PAD', label: 'Pre-authorized debit' },
  { value: 'EFT', label: 'Bank transfer (EFT)' },
  { value: 'IN_KIND', label: 'In kind' },
  { value: 'OTHER', label: 'Other' },
];

export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method;
}

/**
 * What a payment's reference (`externalRef`) is called, by method. It is one
 * stored field (statement matching, the duplicate check), but the operator
 * types a different thing into it for each method; cash and in-kind
 * payments have nothing to enter, so the field is hidden for them (null).
 */
export function paymentReferenceLabel(method: string): string | null {
  switch (method) {
    case 'CHEQUE':
      return 'Cheque number';
    case 'CARD':
    case 'PAD':
      return 'Processor transaction ID';
    case 'EFT':
      return 'Transfer reference';
    case 'CASH':
    case 'IN_KIND':
      return null;
    default:
      return 'Reference';
  }
}
