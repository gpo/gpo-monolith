import type { EntityKind } from '../enums.js';
import type { PeriodRow } from '../period/calendar.js';

/**
 * Entity eligibility (validation-rules.md A2's campaign clause, A3).
 *
 * Spaces are derived, not stored (DESIGN.md §4; SpaceState's own doc
 * comment repeats it: it materializes workflow *stage*, never eligibility).
 * Whether (entityKind, ridingNumber) is a legitimate EO entity for a period
 * is a pure derivation from two tables that already exist — no new
 * registry:
 *
 *  - PARTY: always eligible (no riding).
 *  - CA: eligible wherever `Riding.active` is true. Not period-scoped: CAs
 *    don't activate/deactivate per period in practice, so a single current
 *    flag is correct, not a simplification.
 *  - CAMPAIGN: eligible only during an election period covering the riding
 *    — `period.kind === 'GENERAL_ELECTION'` (party-wide; ridingNumbers is
 *    empty by convention, see PeriodRow) covers every active riding, or
 *    `period.kind === 'BY_ELECTION'` and the riding is named in
 *    `period.ridingNumbers`. Never eligible during `ANNUAL`.
 */
export interface RidingRow {
  ridingNumber: number;
  active: boolean;
}

export function isEntityEligible(
  entityKind: EntityKind,
  ridingNumber: number | null,
  period: PeriodRow | undefined,
  riding: RidingRow | undefined,
): boolean {
  if (entityKind === 'PARTY') return true;
  if (ridingNumber === null) return false; // shape problem; A2's job to report
  if (!riding?.active) return false;
  if (entityKind === 'CA') return true;
  // CAMPAIGN
  if (!period) return false;
  if (period.kind === 'GENERAL_ELECTION') return true;
  if (period.kind === 'BY_ELECTION') return period.ridingNumbers.includes(ridingNumber);
  return false; // ANNUAL: no campaign entity is ever active
}
