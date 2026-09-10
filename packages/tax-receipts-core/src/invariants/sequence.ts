import { z } from 'zod';

/**
 * Receipt-sequence invariant 3 (data-model §2), guarantee G2
 * ("the sequence is sacred"). Pure helpers mirroring the database trigger in
 * ticket 0.3.
 *
 * - Numbers come from one monotonic counter per prefix.
 * - A number is never reused and never freed by cancellation or void.
 * - No gaps at issuance time: an issuance run takes a contiguous block.
 * - Foreign numbers (EO-stock or manual receipts issued outside the tool,
 *   ticket 3.8) are recorded with a source flag and are NOT drawn from or
 *   compared against this counter.
 */

export const RECEIPT_NUMBER_DIGITS = 8;

/** Global receipt maximum observed in the filed artifacts; migration seeds the
 *  sequence at or above this (data-model §7, fixtures README). */
export const LEGACY_GLOBAL_MAX = 402_509;

export const SequenceState = z.object({
  prefix: z.string().min(1),
  /** The last number issued from this prefix. The next issuance is
   *  `counter + 1`. Starts at 0 (nothing issued) or the seeded legacy max. */
  counter: z.number().int().min(0),
});
export type SequenceState = z.infer<typeof SequenceState>;

export function formatReceiptNumber(prefix: string, n: number): string {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`receipt number must be a positive integer, got ${n}`);
  }
  return `${prefix}${String(n).padStart(RECEIPT_NUMBER_DIGITS, '0')}`;
}

const PARSE_RE = /^([A-Za-z]+-)(\d+)$/;

export function parseReceiptNumber(
  value: string,
): { prefix: string; n: number } | null {
  const m = PARSE_RE.exec(value);
  if (!m) return null;
  const n = Number(m[2]);
  if (!Number.isSafeInteger(n) || n < 1) return null;
  return { prefix: m[1]!, n };
}

export interface IssuedBlock {
  /** Inclusive first number of the block. */
  from: number;
  /** Inclusive last number of the block. */
  to: number;
  numbers: string[];
  nextState: SequenceState;
}

/** Reserve a contiguous block of `count` numbers. This is the only way to get
 *  numbers; concurrency safety (U3) is the caller's job via a row lock on the
 *  ReceiptSequence row (see the api issuance service in Phase 3). */
export function reserveBlock(state: SequenceState, count: number): IssuedBlock {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`count must be a positive integer, got ${count}`);
  }
  const from = state.counter + 1;
  const to = state.counter + count;
  const numbers: string[] = [];
  for (let n = from; n <= to; n += 1) {
    numbers.push(formatReceiptNumber(state.prefix, n));
  }
  return {
    from,
    to,
    numbers,
    nextState: { prefix: state.prefix, counter: to },
  };
}

export interface SequenceViolation {
  kind: 'reused' | 'gap' | 'regression' | 'wrong-prefix';
  message: string;
}

/**
 * Validate that a proposed set of newly issued numbers is legal against the
 * current state and the numbers already used: strictly increasing from
 * `counter + 1`, contiguous, never colliding with an existing number.
 */
export function validateIssuance(
  state: SequenceState,
  proposed: readonly string[],
  usedNumbers: ReadonlySet<string>,
): SequenceViolation[] {
  const violations: SequenceViolation[] = [];
  const parsed = proposed.map((p) => ({ raw: p, parsed: parseReceiptNumber(p) }));

  for (const { raw, parsed: pp } of parsed) {
    if (!pp || pp.prefix !== state.prefix) {
      violations.push({
        kind: 'wrong-prefix',
        message: `${raw} is not a number of sequence "${state.prefix}"`,
      });
    }
  }
  if (violations.length > 0) return violations;

  const ns = parsed.map((p) => p.parsed!.n).sort((a, b) => a - b);
  let expected = state.counter + 1;
  for (const n of ns) {
    if (n < expected && usedNumbers.has(formatReceiptNumber(state.prefix, n))) {
      violations.push({
        kind: 'reused',
        message: `${formatReceiptNumber(state.prefix, n)} was already issued`,
      });
    } else if (n < expected) {
      violations.push({
        kind: 'regression',
        message: `${formatReceiptNumber(
          state.prefix,
          n,
        )} is below the sequence counter (${state.counter})`,
      });
    } else if (n > expected) {
      violations.push({
        kind: 'gap',
        message: `gap before ${formatReceiptNumber(
          state.prefix,
          n,
        )}: expected ${formatReceiptNumber(state.prefix, expected)}`,
      });
      expected = n + 1;
    } else {
      expected = n + 1;
    }
  }
  return violations;
}
