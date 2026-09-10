import { z } from 'zod';
import {
  ContributionLimitBucket,
  EntityKind,
  type ContributionLimitBucket as Bucket,
} from '../enums.js';

/**
 * ContributionLimit service (ticket 0.7). Feeds validation rule B2, which
 * gates RTD export and issuance.
 *
 * Everything numeric is DATA (compliance.md, O15): the amounts and which
 * buckets are active in a given year come from the `ContributionLimit` table,
 * never from code. Adding, removing, or re-pricing a bucket row for a year
 * changes behaviour with no code change.
 *
 * What is code: how a contribution is *attributed* to one of the five buckets
 * the tool understands, and how aggregates are *grouped* (the party bucket is
 * one calendar-year aggregate; CA and campaign buckets are per riding entity;
 * the candidate-self bucket exempts the candidate's own campaign only). A
 * genuinely new bucket kind would need a new attribution rule here.
 */

export const ContributionLimitRow = z.object({
  year: z.number().int(),
  bucket: ContributionLimitBucket,
  amountCents: z.number().int().min(0),
  notes: z.string().nullish(),
});
export type ContributionLimitRow = z.infer<typeof ContributionLimitRow>;

export const ContributionForLimits = z.object({
  id: z.string(),
  /** Full contribution amount in cents (monetary or the value of G&S).
   *  Service charges are never deducted (compliance.md). */
  amountCents: z.number().int().min(0),
  goodsServices: z.boolean().default(false),
  entityKind: EntityKind,
  ridingNumber: z.number().int().min(1).max(124).nullable(),
  /** Calendar year the contribution counts toward, evaluated in ET
   *  (see period/calendar.contributionYear). */
  year: z.number().int(),
  /** The donor is the candidate for this riding's campaign and this is a
   *  contribution to their own campaign (routes to CANDIDATE_SELF, and is
   *  exempt from the CAMPAIGN bucket). */
  candidateSelf: z.boolean().default(false),
  /** Contribution to a leadership contestant (routes to LEADERSHIP). */
  leadership: z.boolean().default(false),
});
export type ContributionForLimits = z.infer<typeof ContributionForLimits>;

export interface BucketResult {
  bucket: Bucket;
  /** Stable identity of the aggregation group, e.g. `party`, `ca:84`. */
  groupKey: string;
  ridingNumber: number | null;
  limitCents: number;
  aggregateCents: number;
  /** `max(0, aggregate - limit)`. */
  overageCents: number;
  overLimit: boolean;
  contributionIds: string[];
}

export interface LimitEvaluation {
  year: number;
  results: BucketResult[];
  overLimit: boolean;
}

/** Which bucket a contribution's dollars count against, or `null` if it does
 *  not participate in limit checking (e.g. an unknown configuration). */
export function attributeBucket(c: ContributionForLimits): Bucket | null {
  if (c.leadership) return 'LEADERSHIP';
  if (c.candidateSelf) return 'CANDIDATE_SELF';
  switch (c.entityKind) {
    case 'PARTY':
      return 'PARTY';
    case 'CA':
      return 'CA';
    case 'CAMPAIGN':
      return 'CAMPAIGN';
  }
}

/** The grouping key for a bucket: party/leadership aggregate to one number,
 *  the riding-scoped buckets aggregate per riding. */
function groupKeyFor(bucket: Bucket, ridingNumber: number | null): string {
  switch (bucket) {
    case 'PARTY':
    case 'LEADERSHIP':
      return bucket.toLowerCase();
    case 'CA':
    case 'CAMPAIGN':
    case 'CANDIDATE_SELF':
      return `${bucket.toLowerCase()}:${ridingNumber ?? 'unknown'}`;
  }
}

export interface EvaluateLimitsInput {
  year: number;
  limits: readonly ContributionLimitRow[];
  contributions: readonly ContributionForLimits[];
}

/**
 * Evaluate a single donor's calendar-year aggregates against every applicable
 * limit bucket. Pass only one donor's contributions.
 */
export function evaluateLimits(input: EvaluateLimitsInput): LimitEvaluation {
  const { year } = input;
  const limitByBucket = new Map<Bucket, number>();
  for (const row of input.limits) {
    if (row.year === year) limitByBucket.set(row.bucket, row.amountCents);
  }

  // group -> accumulator
  const groups = new Map<
    string,
    {
      bucket: Bucket;
      ridingNumber: number | null;
      aggregateCents: number;
      contributionIds: string[];
    }
  >();

  for (const c of input.contributions) {
    if (c.year !== year) continue;
    const bucket = attributeBucket(c);
    if (!bucket) continue;
    if (!limitByBucket.has(bucket)) continue; // no configured limit -> not checked
    const key = groupKeyFor(bucket, c.ridingNumber);
    const g = groups.get(key) ?? {
      bucket,
      ridingNumber: c.ridingNumber,
      aggregateCents: 0,
      contributionIds: [],
    };
    g.aggregateCents += c.amountCents;
    g.contributionIds.push(c.id);
    groups.set(key, g);
  }

  const results: BucketResult[] = [];
  for (const [groupKey, g] of groups) {
    const limitCents = limitByBucket.get(g.bucket)!;
    const overageCents = Math.max(0, g.aggregateCents - limitCents);
    results.push({
      bucket: g.bucket,
      groupKey,
      ridingNumber: g.ridingNumber,
      limitCents,
      aggregateCents: g.aggregateCents,
      overageCents,
      overLimit: overageCents > 0,
      contributionIds: g.contributionIds,
    });
  }

  results.sort((a, b) => a.groupKey.localeCompare(b.groupKey));
  return { year, results, overLimit: results.some((r) => r.overLimit) };
}
