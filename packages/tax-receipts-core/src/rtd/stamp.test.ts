import { describe, expect, it } from 'vitest';
import { RTD_FILING_PARTY_ID, buildRtdFilingName } from './stamp.js';

describe('buildRtdFilingName (ticket 2.3)', () => {
  it('matches the real filed example (open-questions.md O18)', () => {
    // 2024_RTD_8_070620241224.csv, filed 2026-08-21's evidence for O18.
    expect(buildRtdFilingName(2024, 8, new Date('2024-07-06T16:24:00Z'))).toBe('2024_RTD_8_070620241224');
  });

  it('the disclosure year is independent of the submission timestamp year (the December-straddle case, ticket 2.7)', () => {
    // A 2026 filing submitted in early January 2027.
    const name = buildRtdFilingName(2026, RTD_FILING_PARTY_ID, new Date('2027-01-04T15:00:00Z'));
    expect(name).toBe('2026_RTD_8_010420271000');
  });

  it('pads single-digit month, day, hour, and minute', () => {
    expect(buildRtdFilingName(2026, 8, new Date('2026-01-02T05:03:00Z'))).toBe('2026_RTD_8_010220260003');
  });
});
