/**
 * Human-readable short descriptions for `WorkItem.ruleRef` values (work
 * queue, contribution detail). Not a restatement of validation-rules.md's
 * full text — just enough for someone triaging the queue to know what
 * they're looking at without memorizing rule codes.
 *
 * Lives here rather than in `@gpo/tax-receipts-core`: it's UI copy, not
 * domain logic, and keeping it here avoids routing the web app's very
 * first real import of that package through its barrel `index.ts`, which
 * re-exports `metadata.ts` — a module whose `node:crypto` usage Vite/Rollup
 * can't cleanly tree-shake out of a browser build (tried `sideEffects:
 * false`; didn't fix it. Worth a proper look if the core package ever
 * needs to ship real logic to the browser, but out of scope here).
 *
 * Includes rules not yet implemented (A9, B5, C5's real check, REP*, E*) so
 * a future ruleRef doesn't fall back to the raw code the day it ships.
 */
export const RULE_LABELS: Record<string, string> = {
  A1: "Acceptance date is outside its period's window",
  A2: 'Riding number or entity kind is invalid for this contribution',
  A3: "Entity isn't active with EO for this period",
  A4: "Received-by doesn't match how the contribution arrived",
  A5: 'Non-deductible amount leaves nothing eligible',
  A6: 'Possible duplicate contribution',
  A7: "Source code's riding doesn't match the metadata riding",
  A8: 'Cash contribution exceeds the $25 EFA limit',
  A9: "G&S invoice doesn't match the contribution amount",
  B1: "Donor's address is out of province",
  B2: 'Donor is over a contribution limit',
  B3: 'Donor is anonymous or unidentifiable',
  B4: 'Possible duplicate donor record',
  B5: "May be recorded under the wrong donor's name",
  C1: "Donor's address is incomplete",
  C2: 'Address contains a comma (EO format)',
  C3: 'Postal code is malformed or outside Ontario',
  C4: "Donor's name isn't printable for a receipt",
  C5: "No address snapshot for this receipt's period",
  E1: "Mirror doesn't match Qomon",
  E2: 'RTD-reported contribution changed; owed-to-EO amendment needed',
  E3: 'Receipted contribution changed; correction action needed',
  E4: 'Contribution deleted in Qomon but still mirrored here',
  E5: 'Entity report is stale; an included receipt changed',
  REP1: "Receipt total doesn't equal its allocations",
  REP2: "Entity total doesn't match the filed return",
  REP3: 'Contribution or submission receipted twice',
  REP4: 'Reported contribution has no valid entity',
  REP5: "Agency flag or fee doesn't reconcile",
  REP6: 'Acceptance and deposit dates cross a year boundary',
  REP7: 'Cancelled or void receipt included in totals',
  REP8: 'S2P2 aggregate omits a modified or reissued receipt',
};

/** Ticket 1.6's intake-derivation flags (`WorkItem.ruleRef = 'INTAKE:<field>'`,
 *  mirror-sweep.ts) — a distinct namespace from the rules above. */
const INTAKE_FIELD_LABELS: Record<string, string> = {
  period_id: 'no period could be derived for this contribution',
  riding_number: "riding number couldn't be derived automatically",
  entity_kind: 'entity kind defaulted, not derived',
  received_by: 'received-by defaulted, not derived',
};

const INTAKE_PREFIX = 'INTAKE:';

/** Human-readable description for a `WorkItem.ruleRef`. Unknown codes fall
 *  back to the raw ref rather than throwing — this must never be the
 *  reason a queue fails to render. */
export function describeRuleRef(ruleRef: string | null): string {
  if (!ruleRef) return '—';
  if (ruleRef.startsWith(INTAKE_PREFIX)) {
    const field = ruleRef.slice(INTAKE_PREFIX.length);
    return `Intake: ${INTAKE_FIELD_LABELS[field] ?? `couldn't derive ${field}`}`;
  }
  return RULE_LABELS[ruleRef] ?? ruleRef;
}
