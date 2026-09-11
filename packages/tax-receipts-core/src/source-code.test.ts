import { describe, expect, it } from 'vitest';
import { parseRidingFromSourceCode } from './source-code.js';

describe('parseRidingFromSourceCode (validation-rules.md rule A7)', () => {
  it('extracts a zero-padded riding segment', () => {
    expect(parseRidingFromSourceCode('TSF.W.007')).toBe(7);
    expect(parseRidingFromSourceCode('CND.W.012')).toBe(12);
  });

  it('returns null for a general/party-level code with no numeric last segment', () => {
    expect(parseRidingFromSourceCode('NC.W.DON.DBK.BTN50')).toBeNull();
  });

  it('returns null for an out-of-range riding number', () => {
    expect(parseRidingFromSourceCode('XX.W.000')).toBeNull();
    expect(parseRidingFromSourceCode('XX.W.999')).toBeNull();
  });

  it('returns null for a null or empty source code', () => {
    expect(parseRidingFromSourceCode(null)).toBeNull();
    expect(parseRidingFromSourceCode('')).toBeNull();
  });

  it('accepts an unpadded but in-range numeric segment', () => {
    expect(parseRidingFromSourceCode('XX.W.7')).toBe(7);
  });

  it('checks only the last dot-separated segment', () => {
    expect(parseRidingFromSourceCode('007.W.DON')).toBeNull();
  });
});
