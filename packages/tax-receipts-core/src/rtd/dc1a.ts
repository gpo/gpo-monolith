import { centsToPlainDecimal } from '../money.js';
import { formatEoDate } from '../period/calendar.js';

/**
 * DC-1A amendment form content (ticket 2.4). eo-reporting.md §1:
 * "Corrections to already-filed records go via Form DC-1A with original
 * details and reason"; corrections.md action 11 ("Retract from EO
 * (DC-1A)"): "generates the DC-1A amendment with original record details,
 * submission date, and reason."
 *
 * No real DC-1A template is available to this build: the Drive folder's
 * "6-Form DC-1A - RTD Amendment Certification (2026).docx" is a private
 * file with no fetch access from here (unlike the RTD CSV header, which
 * `rtd/filing.ts` confirmed against a real example in
 * research/fixtures/README.md). This renders the SUBSTANCE the spec calls
 * for -- original record, submission date, reason -- as a small structured
 * text artifact, not a byte-exact reproduction of EO's own form. Flagged
 * as an open question (open-questions.md), not blocked on it.
 */

export interface Dc1aOriginalRecord {
  contributorLastName: string;
  contributorFirstName: string;
  /** the ORIGINALLY reported deposit date (RtdInclusion is immutable per
   *  the whole system's never-overwrite rule, so this is always the
   *  contribution's `acceptedAt` as first stamped). */
  acceptedAt: Date;
  amountCents: number;
  aggregateAfterCents: number;
  contributionYear: number;
  periodId: number;
  eoContributorId: string | null;
}

export interface Dc1aAmendmentInput {
  originalFilingName: string;
  originalRecord: Dc1aOriginalRecord;
  reason: string;
  submittedAt: Date;
}

export function formatDc1aAmendmentForm(input: Dc1aAmendmentInput): string {
  const r = input.originalRecord;
  const lines = [
    'Form DC-1A -- RTD Amendment Certification',
    `Original filing: ${input.originalFilingName}`,
    `Submission date: ${formatEoDate(input.submittedAt)}`,
    '',
    'Original record details:',
    `  Contributor: ${r.contributorFirstName} ${r.contributorLastName}`.trimEnd(),
    `  Contributor ID: ${r.eoContributorId ?? ''}`,
    `  Contribution Year: ${r.contributionYear}`,
    `  Contribution Period ID: ${r.periodId}`,
    `  Deposit Date: ${formatEoDate(r.acceptedAt)}`,
    `  Contribution Amount: ${centsToPlainDecimal(r.amountCents)}`,
    `  Aggregate Contribution Amount: ${centsToPlainDecimal(r.aggregateAfterCents)}`,
    '',
    'Reason for amendment:',
    input.reason,
  ];
  return lines.join('\n') + '\n';
}
