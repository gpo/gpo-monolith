import { describe, expect, it } from 'vitest';
import { paymentMethodFromQomon, paymentStateFromQomonKind } from './payment.js';

describe('paymentMethodFromQomon', () => {
  it.each([
    ['CB', 'CARD'],
    ['CBTPE', 'CARD'],
    ['CHE', 'CHEQUE'],
    ['PRE', 'PAD'],
    ['VIR', 'EFT'],
    ['ESP', 'CASH'],
    ['card', 'CARD'],
    [' Check ', 'CHEQUE'],
    ['cash', 'CASH'],
  ])('%s -> %s', (kind, expected) => {
    expect(paymentMethodFromQomon(kind)).toBe(expected);
  });

  it('falls back to OTHER for unknown or missing kinds', () => {
    expect(paymentMethodFromQomon('bitcoin')).toBe('OTHER');
    expect(paymentMethodFromQomon(null)).toBe('OTHER');
    expect(paymentMethodFromQomon(undefined)).toBe('OTHER');
  });
});

describe('paymentStateFromQomonKind', () => {
  it.each([
    ['valid', 'RECEIVED'],
    ['unpaid', 'UNPAID'],
    ['reimbursed', 'REFUNDED'],
    ['bank_error', 'BANK_ERROR'],
    ['other', 'OTHER'],
  ])('%s -> %s', (kind, expected) => {
    expect(paymentStateFromQomonKind(kind)).toBe(expected);
  });

  it('resolves kinds outside the documented enum (e.g. cancel) to OTHER', () => {
    expect(paymentStateFromQomonKind('cancel')).toBe('OTHER');
    expect(paymentStateFromQomonKind(null)).toBe('OTHER');
  });
});
