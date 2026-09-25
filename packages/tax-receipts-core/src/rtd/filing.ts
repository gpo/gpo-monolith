import { centsToPlainDecimal } from '../money.js';
import { formatEoDate } from '../period/calendar.js';
import { RTD_FILING_PARTY_ID } from './stamp.js';

/**
 * RTD filing CSV/pipe formatting (ticket 2.6). Header and field order are
 * confirmed against EO's own 2026 RTD example file, not just the prose
 * description in eo-reporting.md §1 (research/fixtures/README.md, "RTD
 * header (10 columns, as printed in EO's 2026 example file)"): the tool
 * emits the EO example's header strings (with spaces), not the legacy
 * `gpo_report` output's underscore-joined names — "the tool emits the EO
 * example's header strings, since that file is EO's own current spec."
 *
 * `Entity ID` is GPO's party id (constant 8, matching `all-report.ts`'s
 * `ALL_REPORT_PARTY_ID` and confirmed by the legacy `gpo_report` output's
 * equivalent column, `Party_ID`) — RTD only ever reports central-party
 * monetary contributions (eo-reporting.md §1), so there is no other entity
 * id it could be.
 */

export const RTD_FILING_HEADER = [
  'Entity ID',
  'CFO Name',
  'Contribution Year',
  'Contribution Period ID',
  'Contributor Last Name',
  'Contributor First Name',
  'Deposit Date',
  'Contribution Amount',
  'Aggregate Contribution Amount',
  'Contributor ID',
] as const;

export type RtdFilingColumn = (typeof RTD_FILING_HEADER)[number];
export type RtdFilingRow = Record<RtdFilingColumn, string | number>;

export interface RtdFilingSourceRow {
  contributionYear: number;
  periodId: number;
  contributorLastName: string;
  contributorFirstName: string;
  /** the deposit's acceptance date (`Deposit Date` in EO's column; RTD's
   *  "Deposit Date" and eo-reporting.md's "acceptance/deposit date" are the
   *  same field — the tool has one date per contribution, `acceptedAt`). */
  acceptedAt: Date;
  amountCents: number;
  aggregateAfterCents: number;
  /** Contribution.eoContributorId. Emitted blank when unset
   *  (open-questions.md O38) rather than fabricated, the same choice
   *  `all-report.ts` makes for the ALL/S2P2 `Contributor_ID` column. */
  eoContributorId: string | null;
}

export function buildRtdFilingRow(
  source: RtdFilingSourceRow,
  cfoName: string,
): RtdFilingRow {
  return {
    'Entity ID': RTD_FILING_PARTY_ID,
    'CFO Name': cfoName,
    'Contribution Year': source.contributionYear,
    'Contribution Period ID': source.periodId,
    'Contributor Last Name': source.contributorLastName,
    'Contributor First Name': source.contributorFirstName,
    'Deposit Date': formatEoDate(source.acceptedAt),
    'Contribution Amount': centsToPlainDecimal(source.amountCents),
    'Aggregate Contribution Amount': centsToPlainDecimal(source.aggregateAfterCents),
    'Contributor ID': source.eoContributorId ?? '',
  };
}

/** Minimal quoting: only when a field contains the delimiter itself, a
 *  double quote, or a newline — the same conservative approach
 *  `reports/csv.ts` takes for ALL/S2P2, and the same two caveats apply
 *  (quoting convention and line ending unverified against real filed
 *  bytes; no RTD filing has been byte-diffed yet either). */
function delimitedField(value: string | number, delimiter: string): string {
  const s = String(value);
  if (s.includes(delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatDelimited(rows: readonly RtdFilingRow[], delimiter: string): string {
  const lines = [RTD_FILING_HEADER.join(delimiter)];
  for (const row of rows) {
    lines.push(RTD_FILING_HEADER.map((col) => delimitedField(row[col], delimiter)).join(delimiter));
  }
  return lines.join('\n') + '\n';
}

/** `.csv`, comma-delimited (eo-reporting.md §1's "Mechanics"). */
export function formatRtdFilingCsv(rows: readonly RtdFilingRow[]): string {
  return formatDelimited(rows, ',');
}

/** `.txt`, pipe-delimited — the alternate EO-accepted format
 *  (eo-reporting.md §1: "as `.csv` or pipe-delimited `.txt`"). */
export function formatRtdFilingPipe(rows: readonly RtdFilingRow[]): string {
  return formatDelimited(rows, '|');
}
