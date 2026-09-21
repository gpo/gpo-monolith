import { centsToPlainDecimal } from '../money.js';
import type { EntityKind, ReceiptStatus } from '../enums.js';
import { ALL_REPORT_PARTY_ID, politicalEntityTypeLetter } from './all-report.js';
import { formatReportCsv } from './csv.js';

/**
 * The S2P2 report (ticket 4.2): Schedule 2 Part 2, the per-entity aggregate
 * of over-$200 contributors. Aggregation rule pinned by reconciliation
 * against all four stored filings — periods 62, 63, 64, and 2024-annual —
 * which the recompute reproduces exactly (research/fixtures/README.md "The
 * S2P2 aggregation rule, pinned by reconciliation"):
 *
 *  - group by (contributor, political entity type, political entity) WITHIN
 *    one period — per entity, not cross-entity like RTD's calendar-year
 *    cross-period aggregate;
 *  - sum only Receipt_Status = ISSUED rows (REP7 — cancelled/void excluded
 *    from every total, though retained as rows on the ALL file);
 *  - G&S rows count toward the aggregate (REP8) — simply by not being
 *    special-cased out; a G&S contribution is an ordinary ISSUED row here;
 *  - keep strictly greater than $200 — the filed data's minimum aggregate is
 *    $200.20, and rows at exactly $200.00 are excluded (a mandatory test
 *    population, per the README).
 *
 * Two S2P2-only quirks the tool reproduces (same source):
 *  - `Contributor_Type` here carries the ENTITY type letter (P/A/C), not the
 *    donor's type like the ALL file (always 'I' there) — the same value as
 *    this row's own `Political_Entity_Type`, just repeated under a
 *    differently-meaning column name;
 *  - a period whose top aggregate does not exceed $200 emits no S2P2 file at
 *    all (not an empty one) — the caller (the api-layer generator) is
 *    responsible for skipping artifact/EntityReport creation when
 *    `buildS2p2Rows` returns `[]`.
 */

export const S2P2_REPORT_HEADER = [
  'Party_ID',
  'Contributor_ID',
  'Political_Entity_Type',
  'Political_Entity',
  'Contribution_Period_ID',
  'Contributor_Type',
  'Contributor_Last_Name',
  'Contributor_First_Name',
  'Organization_Name',
  'Contributor_Address',
  'Contributor_City',
  'Contributor_Province',
  'Contributor_Postal_Code',
  'Aggregate_Contribution_Amount',
] as const;

export type S2p2Column = (typeof S2P2_REPORT_HEADER)[number];
export type S2p2Row = Record<S2p2Column, string | number>;

/** Strictly greater than $200 (research/fixtures/README.md: the minimum
 *  filed aggregate is $200.20; rows at exactly $200.00 are excluded). */
export const S2P2_THRESHOLD_CENTS = 20_000;

export interface S2p2SourceRow {
  status: ReceiptStatus;
  entityKind: EntityKind;
  /** null = party-level; distinguishes e.g. two different CAs from each
   *  other in the grouping key (the group is per SPECIFIC entity, not just
   *  per entity kind). */
  ridingNumber: number | null;
  periodId: number;
  amountCents: number;
  /** the grouping key's donor identity. Deliberately NOT
   *  `eoContributorId` — that field is frequently unset today (O38), and
   *  grouping by it would silently collapse every Contributor_ID-less donor
   *  into a single row. `eoContributorId` is carried separately, for
   *  display only. */
  contactId: string;
  /** carried through only so the caller can recover which receipts fed a
   *  surviving (>$200) group, for `EntityReportReceipt` linking and
   *  dirty-report tracking (ticket 4.5) — not used in aggregation itself. */
  receiptId: string;
  eoContributorId: string | null;
  contributorLastName: string;
  contributorFirstName: string;
  addressLine1: string;
  city: string;
  province: string;
  postalCode: string;
}

export type PoliticalEntitySpace = { ridingNumber: number | null; entityKind: EntityKind };

interface Group {
  entityKind: EntityKind;
  ridingNumber: number | null;
  periodId: number;
  eoContributorId: string | null;
  contributorLastName: string;
  contributorFirstName: string;
  addressLine1: string;
  city: string;
  province: string;
  postalCode: string;
  amountCents: number;
  receiptIds: string[];
}

export interface S2p2Result {
  rows: S2p2Row[];
  /** every ISSUED receipt that fed a group which survived the $200
   *  threshold (i.e. actually appears in `rows`) — what the caller should
   *  record as this report's included set. A receipt whose group didn't
   *  clear $200, or that was CANCELLED/VOID, is not "included" by this
   *  report (REP7's exclude-from-totals meaning carries over: it never
   *  entered a group at all). */
  includedReceiptIds: string[];
}

/**
 * Aggregates a period's report source rows into S2P2 groups and formats the
 * rows EO's spec expects. `sources` should be in the same stable order the
 * ALL report uses (receipt number order) — later rows win ties on which
 * contact/address details a group's non-aggregate columns show, so a
 * donor's most-recently-seen name/address is what prints, matching how a
 * live roster would read.
 */
export function buildS2p2Rows(
  sources: readonly S2p2SourceRow[],
  politicalEntityLabel: (space: PoliticalEntitySpace) => string,
): S2p2Result {
  const groups = new Map<string, Group>();

  for (const source of sources) {
    if (source.status !== 'ISSUED') continue; // REP7
    const key = `${source.contactId}:${source.entityKind}:${source.ridingNumber ?? 'party'}`;
    const existing = groups.get(key);
    if (existing) {
      existing.amountCents += source.amountCents;
      existing.receiptIds.push(source.receiptId);
      existing.eoContributorId = source.eoContributorId ?? existing.eoContributorId;
      existing.contributorLastName = source.contributorLastName;
      existing.contributorFirstName = source.contributorFirstName;
      existing.addressLine1 = source.addressLine1;
      existing.city = source.city;
      existing.province = source.province;
      existing.postalCode = source.postalCode;
    } else {
      groups.set(key, {
        entityKind: source.entityKind,
        ridingNumber: source.ridingNumber,
        periodId: source.periodId,
        eoContributorId: source.eoContributorId,
        contributorLastName: source.contributorLastName,
        contributorFirstName: source.contributorFirstName,
        addressLine1: source.addressLine1,
        city: source.city,
        province: source.province,
        postalCode: source.postalCode,
        amountCents: source.amountCents,
        receiptIds: [source.receiptId],
      });
    }
  }

  const rows: (S2p2Row & { _sortKey: [string, string, string] })[] = [];
  const includedReceiptIds: string[] = [];
  for (const group of groups.values()) {
    if (group.amountCents <= S2P2_THRESHOLD_CENTS) continue; // strictly > $200
    includedReceiptIds.push(...group.receiptIds);
    const entityTypeLetter = politicalEntityTypeLetter(group.entityKind);
    const politicalEntity = politicalEntityLabel({ ridingNumber: group.ridingNumber, entityKind: group.entityKind });
    rows.push({
      Party_ID: ALL_REPORT_PARTY_ID,
      Contributor_ID: group.eoContributorId ?? '',
      Political_Entity_Type: entityTypeLetter,
      Political_Entity: politicalEntity,
      Contribution_Period_ID: group.periodId,
      // S2P2 quirk (see this file's header comment): the entity letter, not
      // the donor's type like the ALL file.
      Contributor_Type: entityTypeLetter,
      Contributor_Last_Name: group.contributorLastName,
      Contributor_First_Name: group.contributorFirstName,
      Organization_Name: '',
      Contributor_Address: group.addressLine1,
      Contributor_City: group.city,
      Contributor_Province: group.province,
      Contributor_Postal_Code: group.postalCode,
      Aggregate_Contribution_Amount: centsToPlainDecimal(group.amountCents),
      _sortKey: [politicalEntity, group.contributorLastName, group.contributorFirstName],
    });
  }

  // Deterministic order (unverified against real filed byte order — same
  // category of assumption as csv.ts's quoting/line-ending; see there).
  rows.sort((a, b) => {
    for (let i = 0; i < 3; i++) {
      const cmp = a._sortKey[i]!.localeCompare(b._sortKey[i]!);
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
  return {
    rows: rows.map(({ _sortKey, ...row }) => row),
    includedReceiptIds,
  };
}

export function formatS2p2Csv(rows: readonly S2p2Row[]): string {
  return formatReportCsv(S2P2_REPORT_HEADER, rows);
}
