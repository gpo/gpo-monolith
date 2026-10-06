import type { EntityKindKey } from './api.js';

/**
 * On-screen wording for the entity a contribution is directed to. The enum
 * values stay PARTY/CA/CAMPAIGN/LEADERSHIP on the wire (EntityKind in
 * @gpo/tax-receipts-core); only the labels are natural language.
 */

export const ENTITY_KIND_OPTIONS: Array<{ value: EntityKindKey; label: string }> = [
  { value: 'PARTY', label: 'Party (province-wide)' },
  { value: 'CA', label: 'Constituency association' },
  { value: 'CAMPAIGN', label: 'Campaign' },
  { value: 'LEADERSHIP', label: 'Leadership contestant' },
];

export function entityKindLabel(entityKind: string): string {
  return ENTITY_KIND_OPTIONS.find((o) => o.value === entityKind)?.label ?? entityKind;
}

/** CA and CAMPAIGN are tied to a riding; PARTY and LEADERSHIP are not
 *  (mirrors isRidingScoped in @gpo/tax-receipts-core). */
export function isRidingScoped(entityKind: string): boolean {
  return entityKind === 'CA' || entityKind === 'CAMPAIGN';
}

/** One line naming who a contribution is directed to, e.g. "Constituency
 *  association, riding 121" or "Leadership contestant: Jordan Rivers". */
export function describeRecipient(r: {
  entityKind: string | null;
  ridingNumber: number | null;
  leadershipContestantName?: string | null;
}): string {
  if (r.entityKind === null) return 'not yet attributed';
  if (r.entityKind === 'LEADERSHIP') {
    return `${entityKindLabel('LEADERSHIP')}: ${r.leadershipContestantName ?? 'not named'}`;
  }
  if (isRidingScoped(r.entityKind)) return `${entityKindLabel(r.entityKind)}, riding ${r.ridingNumber ?? '?'}`;
  return entityKindLabel(r.entityKind);
}

/** What the agency flag means, for help text beside it (EO evaluation row 26). */
export const AGENCY_HELP =
  'An agency contribution is one the party (GPO) received on behalf of another entity: a constituency association, a campaign, or a leadership contestant. Derived from Received by and Recipient kind; it files as Agency_Contribution = Y in the ALL report.';

/** Beside a received-by or political-entity label input: a leadership
 *  receipt or report row uses its contestant's name from the registry, not
 *  the typed label (receiptEntityLabel and withLeadershipContestantLabel in
 *  the api). */
export function leadershipLabelNote(entityKind: string): string | undefined {
  return entityKind === 'LEADERSHIP'
    ? 'Not used for leadership contributions: each prints its own contestant’s name from the record.'
    : undefined;
}
