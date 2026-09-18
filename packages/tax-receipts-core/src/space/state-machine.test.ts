import { describe, expect, it } from 'vitest';
import {
  assertValidTransition,
  classifyTransition,
  InvalidSpaceTransitionError,
  SPACE_STAGE_ORDER,
  stageIndex,
} from './state-machine.js';

describe('space state machine (ticket 1.9, W6 ladder)', () => {
  it('lists the seven W6 stages in order', () => {
    expect(SPACE_STAGE_ORDER).toEqual([
      'intake',
      'queue-clear',
      'reconciled',
      'issued',
      'delivered',
      'reported',
      'sent-to-cfo',
    ]);
  });

  it('classifies a same-stage move as a no-op', () => {
    expect(classifyTransition('reconciled', 'reconciled')).toBe('noop');
  });

  it('classifies any forward move as an advance, including a skip', () => {
    expect(classifyTransition('intake', 'queue-clear')).toBe('advance');
    expect(classifyTransition('intake', 'sent-to-cfo')).toBe('advance');
  });

  it('classifies any backward move as a regression', () => {
    expect(classifyTransition('issued', 'reconciled')).toBe('regress');
    expect(classifyTransition('sent-to-cfo', 'intake')).toBe('regress');
  });

  it('throws for an unknown stage string', () => {
    expect(() => stageIndex('bogus' as never)).toThrow(/unknown space stage/);
  });

  it('assertValidTransition allows no-ops and advances without allowRegress', () => {
    expect(assertValidTransition('intake', 'intake')).toBe('noop');
    expect(assertValidTransition('intake', 'issued')).toBe('advance');
  });

  it('assertValidTransition rejects a regression unless allowRegress is set', () => {
    expect(() => assertValidTransition('issued', 'reconciled')).toThrow(
      InvalidSpaceTransitionError,
    );
    expect(assertValidTransition('issued', 'reconciled', { allowRegress: true })).toBe(
      'regress',
    );
  });
});
