import { centsToPlainDecimal } from '../money.js';
import { formatEoDate } from '../period/calendar.js';
import type { EntityKind, ReceivedBy, ReceiptStatus } from '../enums.js';
import { formatReportCsv } from './csv.js';

/**
 * The ALL report (ticket 4.1): Elections Ontario's per-entity annual
 * contribution roster. Column set, constants, and derivations are pinned
 * against GPO's actually-filed 2025/2024 artifacts, not just the EO spec text
 * (eo-reporting.md §2; research/fixtures/README.md "Verified shapes" and
 * "Verification facts" — the primary evidence, since an earlier spec-only
 * reading of the date format turned out wrong).
 *
 * CSV formatting (quoting convention, line ending) is shared with S2P2 in
 * `csv.ts` — see its header comment for the two formatting assumptions still
 * unverified against real filed bytes.
 *
 * Column layout (ticket 4.4, decisions.md D10): EO's written technical spec
 * (`../eo/reporting-technical-specifications.md`, received directly from EO
 * Compliance 2026-09-02) specifies 21 columns, including an optional
 * `General_Meetings` column GPO's 2025/2024 accepted filings never carried.
 * D10 decided to emit the spec's 21-column layout going forward — it's the
 * document Evaluation Tool rows 68/69 score the tool against, and the extra
 * column costs nothing (always `N`: GPO doesn't bundle contributions with
 * general-meeting tickets, and EO's spec itself calls the field "not
 * currently applicable"). Confirmed by EO's own example row in that spec
 * (21 comma-separated values, `N` in the `General_Meetings` position).
 */

export const ALL_REPORT_PARTY_ID = 8;

export const ALL_REPORT_HEADER = [
  'Party_ID',
  'Contributor_ID',
  'Receipt_Number',
  'Receipt_Status',
  'Agency_Contribution',
  'General_Meetings',
  'Political_Entity_Type',
  'Political_Entity',
  'Contribution_Amount',
  'Contribution_Type',
  'Acceptance_Date',
  'Receipt_Issuance_Date',
  'Contribution_Period_ID',
  'Contributor_Type',
  'Contributor_Last_Name',
  'Contributor_First_Name',
  'Organization_Name',
  'Contributor_Address',
  'Contributor_City',
  'Contributor_Province',
  'Contributor_Postal_Code',
] as const;

export type AllReportColumn = (typeof ALL_REPORT_HEADER)[number];
export type AllReportRow = Record<AllReportColumn, string | number>;

/** Political_Entity_Type letter (glossary.md "Directed to"; letter/count
 *  correspondence to entity kind pinned against the filed 2025 ALL's
 *  P/A/C distribution in research/fixtures/README.md). */
export function politicalEntityTypeLetter(entityKind: EntityKind): 'P' | 'A' | 'C' {
  switch (entityKind) {
    case 'PARTY':
      return 'P';
    case 'CA':
      return 'A';
    case 'CAMPAIGN':
      return 'C';
  }
}

/** Receipt_Status letter (compliance.md "Reconciliation expectations": both
 *  cancelled and void receipts "remain in filings at full value with status
 *  C" — EO's spec has no separate void letter, so VOID files identically to
 *  CANCELLED here; rule REP7 is what keeps either out of downstream totals,
 *  not this mapping). */
export function receiptStatusLetter(status: ReceiptStatus): 'I' | 'C' {
  return status === 'ISSUED' ? 'I' : 'C';
}

/** Agency_Contribution derivation (data-model.md §2, point 8, verbatim):
 *  `received_by = GPO AND entity_kind != PARTY`. */
export function isAgencyContribution(receivedBy: ReceivedBy, entityKind: EntityKind): boolean {
  return receivedBy === 'GPO' && entityKind !== 'PARTY';
}

export interface AllReportSourceRow {
  receiptNumber: string;
  status: ReceiptStatus;
  entityKind: EntityKind;
  /** the EO period id this receipt was issued into (Receipt.periodId). */
  periodId: number;
  issueDate: Date;
  /** the receipt's total, already summed over its allocations (invariant:
   *  a receipt has no stored total, data-model.md §2). */
  amountCents: number;
  /** the underlying contribution's acceptance date. Only defined for a
   *  single-allocation receipt — see the doc comment on
   *  `MultiAllocationReceiptError` in the api-layer generator
   *  (apps/tax-receipts/api/src/reports/all-report.ts) for why consolidated
   *  receipts aren't supported here yet. */
  acceptedAt: Date;
  goodsServices: boolean;
  receivedBy: ReceivedBy;
  /** Contribution.eoContributorId. Null in the common case today —
   *  no ticket populates it yet (data-model.md §3 marks it optional); emitted
   *  as an empty field rather than fabricated. EO's spec calls this
   *  mandatory for GPO (eo-reporting.md §1), so a report with blank
   *  Contributor_ID values is not yet fully spec-compliant — tracked as a
   *  gap, not silently worked around. */
  eoContributorId: string | null;
  /** from Contact.lastName/firstName (ticket 4.1's schema addition) —
   *  Qomon's own name split, not a heuristic parse of the joined display
   *  name. Falls back to the joined name in the last-name slot when Qomon
   *  never supplied a split (e.g. an org-only contact), so no row silently
   *  loses the donor's identity; see the api-layer generator for the exact
   *  fallback. */
  contributorLastName: string;
  contributorFirstName: string;
  addressLine1: string;
  city: string;
  province: string;
  postalCode: string;
}

export function buildAllReportRow(
  source: AllReportSourceRow,
  politicalEntityLabel: string,
): AllReportRow {
  return {
    Party_ID: ALL_REPORT_PARTY_ID,
    Contributor_ID: source.eoContributorId ?? '',
    Receipt_Number: source.receiptNumber,
    Receipt_Status: receiptStatusLetter(source.status),
    Agency_Contribution: isAgencyContribution(source.receivedBy, source.entityKind) ? 'Y' : 'N',
    // Constant 'N' (D10, decisions.md): GPO has no concept of bundling a
    // contribution with a general-meeting ticket; EO's own spec calls the
    // field "not currently applicable".
    General_Meetings: 'N',
    Political_Entity_Type: politicalEntityTypeLetter(source.entityKind),
    Political_Entity: politicalEntityLabel,
    Contribution_Amount: centsToPlainDecimal(source.amountCents),
    // Constant per compliance.md: corporate/union contributions are banned
    // with no exception path, so the tool never emits Contributor_Type 'C'
    // (unlike the legacy filed data, which carries 3 such rows from before
    // that rule was enforced — see research/fixtures/README.md).
    Contribution_Type: source.goodsServices ? 'GS' : 'MO',
    Acceptance_Date: formatEoDate(source.acceptedAt),
    Receipt_Issuance_Date: formatEoDate(source.issueDate),
    Contribution_Period_ID: source.periodId,
    Contributor_Type: 'I',
    Contributor_Last_Name: source.contributorLastName,
    Contributor_First_Name: source.contributorFirstName,
    // Always blank: Contributor_Type is always 'I' (see above), and
    // Organization_Name is EO's field for the corporate-donor exception this
    // tool doesn't support.
    Organization_Name: '',
    Contributor_Address: source.addressLine1,
    Contributor_City: source.city,
    Contributor_Province: source.province,
    Contributor_Postal_Code: source.postalCode,
  };
}

export function formatAllReportCsv(rows: readonly AllReportRow[]): string {
  return formatReportCsv(ALL_REPORT_HEADER, rows);
}
