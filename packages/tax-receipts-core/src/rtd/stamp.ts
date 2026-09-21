import { DateTime } from 'luxon';
import { ET_ZONE } from '../period/calendar.js';

/**
 * RTD filing name (ticket 2.3, eo-reporting.md §1's "Mechanics"): the EO
 * filename convention `<Year>_RTD_<PartyID>_MMDDYYYYHHMM`, minute-precision,
 * ET wall-clock. Confirmed against a real filed name (open-questions.md
 * O18): `2024_RTD_8_070620241224.csv` — `<Year>` is the DISCLOSURE year
 * (the contributions being reported), which is independent of the
 * timestamp's own year: the December-straddle case (ticket 2.7) files a
 * 2026 filing with a January-2027 submission timestamp.
 */

/** GPO's EO party id (same figure as the ALL/S2P2 reports' `Party_ID`,
 *  `reports/all-report.ts`'s `ALL_REPORT_PARTY_ID`). */
export const RTD_FILING_PARTY_ID = 8;

export function buildRtdFilingName(year: number, partyId: number, instant: Date): string {
  const dt = DateTime.fromJSDate(instant, { zone: ET_ZONE });
  const mm = String(dt.month).padStart(2, '0');
  const dd = String(dt.day).padStart(2, '0');
  const hh = String(dt.hour).padStart(2, '0');
  const min = String(dt.minute).padStart(2, '0');
  return `${year}_RTD_${partyId}_${mm}${dd}${dt.year}${hh}${min}`;
}
