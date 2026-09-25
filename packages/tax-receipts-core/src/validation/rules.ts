import {
  evaluateLimits,
  type ContributionForLimits,
  type ContributionLimitRow,
} from '../limits/contribution-limit.js';
import type { PeriodRow } from '../period/calendar.js';
import { parseRidingFromSourceCode } from '../source-code.js';
import { isEntityEligible, type RidingRow } from '../space/eligibility.js';
import type {
  AddressForValidation,
  ContributionForValidationRules,
  ValidationFinding,
} from './types.js';

/**
 * Validation rule registry (validation-rules.md). Ticket 1.7 shipped a v1
 * subset; ticket 2.1 completes A/B/C coverage except for two rules that
 * need data no ticket populates yet — see the doc comments on
 * `checkA9GoodsServicesInvoice`-shaped gap (A9 was never added: no
 * `Contribution` field records invoice amount/paid status, and the
 * Qomon metadata JSON schema doesn't carry one either) and
 * `checkB5PayerAttribution` likewise (B5: no structured payer-name field
 * exists on a Qomon transaction, only a free-text `comment`; matching
 * against that would be guessing, not checking). Both are open questions
 * (open-questions.md), not silently skipped.
 *
 * Still out of scope here, and why:
 *  - REP*: report-generation-time checks (Phase 4).
 *  - E1 (mirror matches Qomon), E4 (deleted in Qomon): already structurally
 *    enforced by the mirror sweep itself (ticket 1.1's diff queue / sync
 *    incident paths), not a separate rule to re-run here.
 *  - E2, E3, E5: need RTD inclusions / receipts / entity reports. E2 lands
 *    with ticket 2.3 (RtdInclusion stamping); E3, E5 are Phase 3/4.
 *
 * Each rule is a pure function: one `ValidationFinding | null`, or a pure
 * function over pre-fetched candidate data for the cross-row rules (A6, B2,
 * B4) — the DB fetching that assembles those candidates is an api-layer
 * concern (apps/tax-receipts/api/src/validation/run.ts).
 */

export function checkA1PeriodWindow(
  c: ContributionForValidationRules,
  period: PeriodRow | undefined,
): ValidationFinding | null {
  if (!period) {
    return {
      ruleRef: 'A1',
      message: `metadata references period ${c.metadata.periodId}, which is not configured`,
    };
  }
  const t = c.acceptedAt.getTime();
  if (t < period.startsAt.getTime() || t >= period.endsAt.getTime()) {
    return {
      ruleRef: 'A1',
      message: `acceptance date ${c.acceptedAt.toISOString()} falls outside period ${period.id}'s window (${period.startsAt.toISOString()}..${period.endsAt.toISOString()})`,
    };
  }
  return null;
}

/** `period` and `riding` feed the "CAMPAIGN only in a riding with an active
 *  campaign for the period" clause via `isEntityEligible` (space/eligibility.ts);
 *  omit both to skip just that clause (e.g. a caller without period context
 *  yet) — the shape checks below still run. */
export function checkA2RidingEntityConsistency(
  c: ContributionForValidationRules,
  period?: PeriodRow,
  riding?: RidingRow,
): ValidationFinding | null {
  const { entityKind, ridingNumber } = c.metadata;
  if (entityKind === 'PARTY' && ridingNumber !== null) {
    return { ruleRef: 'A2', message: 'entity kind PARTY must not carry a riding number' };
  }
  if (entityKind !== 'PARTY' && ridingNumber === null) {
    return { ruleRef: 'A2', message: `entity kind ${entityKind} requires a riding number` };
  }
  if (ridingNumber !== null && (ridingNumber < 1 || ridingNumber > 124)) {
    return { ruleRef: 'A2', message: `riding number ${ridingNumber} is out of range (1-124)` };
  }
  if (
    entityKind === 'CAMPAIGN' &&
    ridingNumber !== null &&
    ridingNumber >= 1 &&
    ridingNumber <= 124 &&
    (period !== undefined || riding !== undefined) &&
    !isEntityEligible('CAMPAIGN', ridingNumber, period, riding)
  ) {
    return {
      ruleRef: 'A2',
      message: `riding ${ridingNumber} has no active campaign for period ${period?.id ?? c.metadata.periodId}`,
    };
  }
  return null;
}

/** Entity-active half of A3 (the "no placeholder ids / 'None'/'NIL'" half
 *  is a separate open question — see open-questions.md; it isn't about
 *  `ridingNumber`, which A2 already range-checks, so it's not attempted
 *  here). Only the CA case: PARTY is always active, and CAMPAIGN's
 *  activity is A2's "active campaign for the period" clause above — same
 *  underlying data, but A2 treats it as a metadata-shape problem ("fix
 *  metadata") while A3 is a genuine entity-lifecycle problem ("reallocate
 *  to an active entity") that only makes sense for a standing entity like
 *  a CA, not a time-boxed campaign. */
export function checkA3EntityActive(
  c: ContributionForValidationRules,
  riding: RidingRow | undefined,
): ValidationFinding | null {
  const { entityKind, ridingNumber } = c.metadata;
  if (entityKind !== 'CA') return null;
  if (ridingNumber === null || ridingNumber < 1 || ridingNumber > 124) return null; // A2's shape problem
  if (isEntityEligible('CA', ridingNumber, undefined, riding)) return null;
  return {
    ruleRef: 'A3',
    message: `riding ${ridingNumber}'s CA is not active with EO (defunct or unregistered)`,
  };
}

/** Only invariant 8's confident clause is checkable: "a processor record
 *  forces GPO." Distinguishing a CFO-subspace entry (defaults ENTITY) from
 *  central manual entry (defaults GPO) needs the same riding/subspace
 *  identification ticket 1.6 flags as blocked pending B3
 *  (intake/defaults.ts) — asserting that half here would false-positive on
 *  every un-overridden ENTITY contribution, so it waits for B3. */
export function checkA4ReceivedByProvenance(
  c: ContributionForValidationRules,
): ValidationFinding | null {
  const isProcessorRecord = c.externalRef != null && c.externalRef.trim().length > 0;
  if (isProcessorRecord && c.metadata.receivedBy !== 'GPO') {
    return {
      ruleRef: 'A4',
      message: `contribution has a processor external_ref but received_by is ${c.metadata.receivedBy}; a processor record forces GPO (invariant 8)`,
    };
  }
  return null;
}

/** The "or contribution marked non-receiptable" half of A5 has no field to
 *  check yet — no such flag exists on Contribution. */
export function checkA5NonDeductible(
  c: ContributionForValidationRules,
): ValidationFinding | null {
  if (c.metadata.nonDeductibleCents > c.amountCents) {
    return {
      ruleRef: 'A5',
      message: `non-deductible amount (${c.metadata.nonDeductibleCents}c) exceeds the contribution (${c.amountCents}c)`,
    };
  }
  if (c.amountCents - c.metadata.nonDeductibleCents <= 0) {
    return {
      ruleRef: 'A5',
      message: 'eligible amount is zero; fix amounts (no "non-receiptable" flag exists yet to mark this deliberate)',
    };
  }
  return null;
}

export interface DuplicateContributionCandidate {
  id: string;
  amountCents: number;
  acceptedAt: Date;
  externalRef: string | null;
  entityKind: string;
  ridingNumber: number | null;
}

/** Window judgment call: 3 days either side of the subject's acceptance
 *  date. Not specified by validation-rules.md beyond "within a window";
 *  revisit once real duplicate cases are seen. */
export const DUPLICATE_CONTRIBUTION_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export function checkA6DuplicateContribution(
  c: ContributionForValidationRules,
  candidates: readonly DuplicateContributionCandidate[],
): ValidationFinding | null {
  for (const other of candidates) {
    if (other.id === c.id) continue;
    if (c.externalRef && other.externalRef && c.externalRef === other.externalRef) {
      return { ruleRef: 'A6', message: `duplicate external_ref with contribution ${other.id}` };
    }
    const sameEntity =
      other.entityKind === c.metadata.entityKind && other.ridingNumber === c.metadata.ridingNumber;
    const sameAmount = other.amountCents === c.amountCents;
    const withinWindow =
      Math.abs(other.acceptedAt.getTime() - c.acceptedAt.getTime()) <=
      DUPLICATE_CONTRIBUTION_WINDOW_MS;
    if (sameEntity && sameAmount && withinWindow) {
      return {
        ruleRef: 'A6',
        message: `possible duplicate of contribution ${other.id}: same donor, amount, entity, within ${
          DUPLICATE_CONTRIBUTION_WINDOW_MS / 86_400_000
        } days`,
      };
    }
  }
  return null;
}

export function checkA7SourceCodeRiding(
  c: ContributionForValidationRules,
): ValidationFinding | null {
  const parsed = parseRidingFromSourceCode(c.metadata.sourceCode);
  if (parsed === null) return null; // undirected code: nothing to compare
  if (c.metadata.ridingNumber !== parsed) {
    return {
      ruleRef: 'A7',
      message: `source code "${c.metadata.sourceCode}" implies riding ${parsed}, but metadata riding is ${
        c.metadata.ridingNumber ?? 'null'
      }`,
    };
  }
  return null;
}

/** EFA cash limit, $25 (validation-rules.md A8). */
export const CASH_LIMIT_CENTS = 2_500;

export function checkA8CashLimit(c: ContributionForValidationRules): ValidationFinding | null {
  if (c.paymentMethod !== 'CASH') return null;
  if (c.amountCents > CASH_LIMIT_CENTS) {
    return {
      ruleRef: 'A8',
      message: `cash contribution of ${c.amountCents}c exceeds the $25 EFA cash limit`,
    };
  }
  return null;
}

/** Only the "out of province" half is checkable: no `non_deductible`-style
 *  non-resident flag exists on Contribution. A null address defers
 *  to C1 (address completeness) rather than double-reporting. */
export function checkB1OutOfProvince(
  address: AddressForValidation | null,
): ValidationFinding | null {
  if (!address) return null;
  const province = address.province.trim().toUpperCase();
  if (province.length === 0) return null; // C1's problem
  if (province !== 'ON' && province !== 'ONTARIO') {
    return {
      ruleRef: 'B1',
      message: `donor address province "${address.province}" is out of province`,
    };
  }
  return null;
}

const ANONYMOUS_DONOR_NAME_PATTERN = /^(anonymous|unknown|n\/a|none|nil)$/i;

export function checkB3AnonymousDonor(contactName: string): ValidationFinding | null {
  const trimmed = contactName.trim();
  if (!trimmed || ANONYMOUS_DONOR_NAME_PATTERN.test(trimmed)) {
    return { ruleRef: 'B3', message: `donor name "${contactName}" is anonymous or unidentifiable` };
  }
  return null;
}

export interface OverLimitCheckInput {
  contribution: ContributionForLimits;
  /** the donor's OTHER contributions this calendar year (excludes the subject). */
  otherContributionsThisYear: readonly ContributionForLimits[];
  limits: readonly ContributionLimitRow[];
}

/** No data source yet for `candidateSelf` / `leadership` (0.7's
 *  attribution flags): every contribution here attributes via entity kind
 *  only (PARTY/CA/CAMPAIGN), never LEADERSHIP/CANDIDATE_SELF. */
export function checkB2OverLimit(input: OverLimitCheckInput): ValidationFinding | null {
  const evaluation = evaluateLimits({
    year: input.contribution.year,
    limits: input.limits,
    contributions: [input.contribution, ...input.otherContributionsThisYear],
  });
  const overBucket = evaluation.results.find(
    (r) => r.overLimit && r.contributionIds.includes(input.contribution.id),
  );
  if (!overBucket) return null;
  return {
    ruleRef: 'B2',
    message: `donor's ${overBucket.bucket} aggregate (${overBucket.aggregateCents}c) exceeds the ${overBucket.limitCents}c limit by ${overBucket.overageCents}c`,
  };
}

export interface DuplicateContactCandidate {
  contactId: string;
  email: string | null;
}

/** Only the email-match half of B4 is checkable: "same name + address"
 *  needs AddressSnapshot data no ticket populates yet. */
export function checkB4DuplicateContributorByEmail(
  contactId: string,
  email: string | null,
  candidates: readonly DuplicateContactCandidate[],
): ValidationFinding | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  const match = candidates.find(
    (c) => c.contactId !== contactId && c.email?.trim().toLowerCase() === normalized,
  );
  if (!match) return null;
  return {
    ruleRef: 'B4',
    message: `possible duplicate contact ${match.contactId} shares email ${email}`,
  };
}

export function checkC1AddressComplete(
  address: AddressForValidation | null,
): ValidationFinding | null {
  if (!address) return { ruleRef: 'C1', message: 'no address on file' };
  const missing: string[] = [];
  if (!address.line1.trim()) missing.push('street');
  if (!address.city.trim()) missing.push('city');
  if (!address.province.trim()) missing.push('province');
  if (!address.postalCode.trim()) missing.push('postal code');
  if (missing.length > 0) {
    return { ruleRef: 'C1', message: `address missing: ${missing.join(', ')}` };
  }
  return null;
}

/** No `line2` to check: `AddressForValidation` folds housenumber+street
 *  into one `line1` (see its doc comment). */
export function checkC2AddressNoCommas(
  address: AddressForValidation | null,
): ValidationFinding | null {
  if (!address || !address.line1.includes(',')) return null;
  return {
    ruleRef: 'C2',
    message: `address line "${address.line1}" contains a comma; EO format requires comma-free lines`,
  };
}

const CA_POSTAL_CODE_PATTERN = /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/;
const ONTARIO_POSTAL_FIRST_LETTERS = new Set(['K', 'L', 'M', 'N', 'P']);

export function checkC3PostalCode(
  address: AddressForValidation | null,
): ValidationFinding | null {
  if (!address) return null; // C1's problem
  const postalCode = address.postalCode.trim();
  if (!postalCode) return null; // C1's problem
  if (!CA_POSTAL_CODE_PATTERN.test(postalCode)) {
    return { ruleRef: 'C3', message: `postal code "${postalCode}" is not a well-formed Canadian postal code` };
  }
  if (!ONTARIO_POSTAL_FIRST_LETTERS.has(postalCode[0]!.toUpperCase())) {
    return { ruleRef: 'C3', message: `postal code "${postalCode}" is outside Ontario's range (starts K/L/M/N/P)` };
  }
  return null;
}

export function checkC4PrintableName(contactName: string): ValidationFinding | null {
  const trimmed = contactName.trim();
  if (!trimmed) return { ruleRef: 'C4', message: 'donor name is blank' };
  if (trimmed.includes('.')) {
    return {
      ruleRef: 'C4',
      message: `name "${trimmed}" contains a period, suggesting an initial; RTD requires full first and last names`,
    };
  }
  if (/\b(and|&)\b/i.test(trimmed)) {
    return { ruleRef: 'C4', message: `name "${trimmed}" looks like a joint name; pick one person` };
  }
  if (trimmed.split(/\s+/).length < 2) {
    return { ruleRef: 'C4', message: `name "${trimmed}" is missing a first or last name` };
  }
  return null;
}

/** No-op until Phase 3 creates `AddressSnapshot` rows (data-model §2: a
 *  snapshot is captured "once an ISSUED receipt references it", invariant
 *  7 — there is nothing to check before a receipt exists). Kept as a named
 *  rule, always passing, so the registry's rule list matches
 *  validation-rules.md and the real check has an obvious place to land. */
export function checkC5AddressSnapshotExists(): ValidationFinding | null {
  return null;
}

export interface RuleRunContext {
  contribution: ContributionForValidationRules;
  contactId: string;
  contactName: string;
  contactEmail: string | null;
  /** the donor's live Qomon address, parsed (see AddressForValidation) —
   *  null if absent or unparseable. Feeds B1, C1-C3. */
  address: AddressForValidation | null;
  period: PeriodRow | undefined;
  /** undefined when the metadata riding isn't a known `Riding` row.
   *  Feeds A2's campaign-activity clause and A3. */
  riding: RidingRow | undefined;
  duplicateContributionCandidates: readonly DuplicateContributionCandidate[];
  duplicateContactCandidates: readonly DuplicateContactCandidate[];
  /** null skips B2 entirely (e.g. no limit rows configured for the year). */
  overLimit: {
    contributionYear: number;
    otherContributionsThisYear: readonly ContributionForLimits[];
    limits: readonly ContributionLimitRow[];
  } | null;
}

/** Runs every v1 rule against one contribution and returns every finding
 *  (order matches the table above). The caller (api layer) reconciles these
 *  against existing WorkItems — this function has no knowledge of WorkItem
 *  or the database. */
export function runContributionRules(ctx: RuleRunContext): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const push = (f: ValidationFinding | null): void => {
    if (f) findings.push(f);
  };

  push(checkA1PeriodWindow(ctx.contribution, ctx.period));
  push(checkA2RidingEntityConsistency(ctx.contribution, ctx.period, ctx.riding));
  push(checkA3EntityActive(ctx.contribution, ctx.riding));
  push(checkA4ReceivedByProvenance(ctx.contribution));
  push(checkA5NonDeductible(ctx.contribution));
  push(checkA6DuplicateContribution(ctx.contribution, ctx.duplicateContributionCandidates));
  push(checkA7SourceCodeRiding(ctx.contribution));
  push(checkA8CashLimit(ctx.contribution));
  push(checkB1OutOfProvince(ctx.address));
  push(checkB3AnonymousDonor(ctx.contactName));
  if (ctx.overLimit) {
    push(
      checkB2OverLimit({
        contribution: {
          id: ctx.contribution.id,
          amountCents: ctx.contribution.amountCents,
          goodsServices: ctx.contribution.metadata.goodsServices,
          entityKind: ctx.contribution.metadata.entityKind,
          ridingNumber: ctx.contribution.metadata.ridingNumber,
          year: ctx.overLimit.contributionYear,
          candidateSelf: false,
          leadership: false,
        },
        otherContributionsThisYear: ctx.overLimit.otherContributionsThisYear,
        limits: ctx.overLimit.limits,
      }),
    );
  }
  push(checkB4DuplicateContributorByEmail(ctx.contactId, ctx.contactEmail, ctx.duplicateContactCandidates));
  push(checkC1AddressComplete(ctx.address));
  push(checkC2AddressNoCommas(ctx.address));
  push(checkC3PostalCode(ctx.address));
  push(checkC4PrintableName(ctx.contactName));
  push(checkC5AddressSnapshotExists());

  return findings;
}

/** Every ruleRef `runContributionRules` can attach to a `ValidationFinding`
 *  today — including C5 (always a no-op placeholder, see its doc comment
 *  above) and B2 (only runs when the caller supplies `overLimit`). Kept as
 *  an explicit list beside the function above, rather than derived at
 *  runtime, because that no-op and that guard mean "fire every rule and
 *  collect what comes back" can't discover the full set on its own.
 *  Consumers that need a reference to "every rule this engine checks"
 *  (e.g. the admin app's validation-rules page) should read this rather
 *  than re-deriving it, so it stays a single list to update when a rule is
 *  added or removed here. */
export const IMPLEMENTED_RULE_REFS = [
  'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8',
  'B1', 'B2', 'B3', 'B4',
  'C1', 'C2', 'C3', 'C4', 'C5',
] as const;
