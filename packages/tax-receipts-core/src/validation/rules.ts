import {
  evaluateLimits,
  type ContributionForLimits,
  type ContributionLimitRow,
} from '../limits/contribution-limit.js';
import type { PeriodRow } from '../period/calendar.js';
import { parseRidingFromSourceCode } from '../source-code.js';
import type { ContributionForValidationRules, ValidationFinding } from './types.js';

/**
 * Validation rule registry v1 (ticket 1.7, validation-rules.md). Phase 1
 * pulls forward a subset of the full A/B/C/REP/E catalogue — the rules that
 * are checkable with data this phase actually has. Full A/B/C coverage is
 * Phase 2 ticket 2.1. Not included here, and why:
 *
 *  - A3, A4, A9, B1, B3, B5, C1-C5: need data this phase doesn't populate
 *    yet (entity-active roster, invoice records, address snapshots).
 *  - REP*: report-generation-time checks (Phase 4).
 *  - E1 (mirror matches Qomon), E4 (deleted in Qomon): already structurally
 *    enforced by the mirror sweep itself (ticket 1.1's diff queue / sync
 *    incident paths), not a separate rule to re-run here.
 *  - E2, E3, E5: need RTD inclusions / receipts / entity reports, none of
 *    which exist until Phase 2/3/4.
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

/** The "CAMPAIGN only in a riding with an active campaign for the period"
 *  half of A2 is not checked here: no active-campaign roster exists yet. */
export function checkA2RidingEntityConsistency(
  c: ContributionForValidationRules,
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
  return null;
}

/** The "or contribution marked non-receiptable" half of A5 has no field to
 *  check yet — no such flag exists on ContributionMetadata. */
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
  if (c.paymentMethodKind?.toLowerCase() !== 'cash') return null;
  if (c.amountCents > CASH_LIMIT_CENTS) {
    return {
      ruleRef: 'A8',
      message: `cash contribution of ${c.amountCents}c exceeds the $25 EFA cash limit`,
    };
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

export interface RuleRunContext {
  contribution: ContributionForValidationRules;
  contactId: string;
  contactEmail: string | null;
  period: PeriodRow | undefined;
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
  push(checkA2RidingEntityConsistency(ctx.contribution));
  push(checkA5NonDeductible(ctx.contribution));
  push(checkA6DuplicateContribution(ctx.contribution, ctx.duplicateContributionCandidates));
  push(checkA7SourceCodeRiding(ctx.contribution));
  push(checkA8CashLimit(ctx.contribution));
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

  return findings;
}
