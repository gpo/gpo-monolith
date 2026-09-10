import { z } from 'zod';

/**
 * All money in the tool is integer cents (data-model §2). Never floats:
 * "$3,425.00" is 342500. Amounts on EO files are the FULL contribution;
 * service charges are never deducted (compliance.md).
 */
export const Cents = z
  .number()
  .int('amounts are integer cents')
  .describe('integer cents');
export type Cents = number;

export const NonNegativeCents = Cents.min(0);

export function centsToDisplay(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}$${dollars.toLocaleString('en-CA')}.${rem.toString().padStart(2, '0')}`;
}

/** Eligible (receiptable) amount = total minus the non-deductible portion. */
export function eligibleAmountCents(
  amountCents: number,
  nonDeductibleCents: number,
): number {
  return amountCents - nonDeductibleCents;
}
