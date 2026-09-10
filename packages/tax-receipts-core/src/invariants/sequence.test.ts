import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  formatReceiptNumber,
  parseReceiptNumber,
  reserveBlock,
  validateIssuance,
  type SequenceState,
} from './sequence.js';

const state = (counter: number): SequenceState => ({ prefix: 'GPO-', counter });

describe('formatReceiptNumber / parseReceiptNumber', () => {
  it('zero-pads to 8 digits like the filed artifacts (GPO-00386964)', () => {
    expect(formatReceiptNumber('GPO-', 386_964)).toBe('GPO-00386964');
  });

  it('round-trips', () => {
    const n = parseReceiptNumber('GPO-00386964');
    expect(n).toEqual({ prefix: 'GPO-', n: 386_964 });
  });

  it('rejects malformed numbers (the legacy "61" defect)', () => {
    expect(parseReceiptNumber('61')).toBeNull();
  });
});

describe('reserveBlock', () => {
  it('takes a contiguous block starting at counter + 1', () => {
    const block = reserveBlock(state(402_509), 3);
    expect(block.numbers).toEqual([
      'GPO-00402510',
      'GPO-00402511',
      'GPO-00402512',
    ]);
    expect(block.nextState.counter).toBe(402_512);
  });
});

describe('validateIssuance', () => {
  it('accepts the exact next contiguous block', () => {
    expect(validateIssuance(state(100), ['GPO-00000101', 'GPO-00000102'], new Set())).toEqual(
      [],
    );
  });

  it('flags a gap', () => {
    const v = validateIssuance(state(100), ['GPO-00000102'], new Set());
    expect(v[0]?.kind).toBe('gap');
  });

  it('flags reuse of an already-issued number (cancellation never frees it)', () => {
    const used = new Set(['GPO-00000050']);
    const v = validateIssuance(state(100), ['GPO-00000050'], used);
    expect(v[0]?.kind).toBe('reused');
  });

  it('flags a number below the counter', () => {
    const v = validateIssuance(state(100), ['GPO-00000050'], new Set());
    expect(v[0]?.kind).toBe('regression');
  });

  it('flags a foreign prefix', () => {
    const v = validateIssuance(state(100), ['EO-00000101'], new Set());
    expect(v[0]?.kind).toBe('wrong-prefix');
  });
});

describe('property: sequential issuance never skips or reuses (U3)', () => {
  it('concatenated blocks form one gapless strictly-increasing run', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500_000 }),
        fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 30 }),
        (seed, counts) => {
          let s = state(seed);
          const all: string[] = [];
          for (const count of counts) {
            const block = reserveBlock(s, count);
            expect(validateIssuance(s, block.numbers, new Set(all))).toEqual([]);
            all.push(...block.numbers);
            s = block.nextState;
          }
          const parsed = all.map((n) => parseReceiptNumber(n)!.n);
          for (let i = 1; i < parsed.length; i += 1) {
            expect(parsed[i]).toBe(parsed[i - 1]! + 1);
          }
          expect(new Set(all).size).toBe(all.length);
        },
      ),
    );
  });
});
