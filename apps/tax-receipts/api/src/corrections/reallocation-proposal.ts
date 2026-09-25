import { contributionYear, evaluateLimits, type BucketResult, type ContributionForLimits } from '@gpo/tax-receipts-core';
import { ContributionNotFoundError } from '../contributions/metadata-edit.js';
import type { EntityKind, PrismaClient } from '../generated/prisma/index.js';
import { ContributionNotActiveError } from './contribution-correction.js';

/**
 * The guided half of correction action 9 (corrections.md): show the donor's
 * cross-entity year, and propose where an over-limit contribution can go. The
 * proposal is advice, not a write; the operator executes it as a REALLOCATE
 * (with a filer's sign-off), choosing a riding where a new CA or campaign
 * bucket is needed.
 *
 * Limits are data (`ContributionLimit`), so the headroom of every other bucket
 * comes from the table for the contribution's year; a bucket with no row is not
 * a destination.
 */

export interface ReallocationOption {
  entityKind: EntityKind;
  /** null when the operator has to pick the riding (no existing bucket for it) */
  ridingNumber: number | null;
  needsRiding: boolean;
  headroomCents: number;
  /** the most that can move there and still help: min(overage, headroom, amount) */
  moveCents: number;
}

export interface ReallocationProposal {
  contributionId: string;
  contactId: string;
  year: number;
  amountCents: number;
  /** the bucket the contribution currently counts against, when over its limit */
  overLimitBucket: { bucket: string; groupKey: string; limitCents: number; aggregateCents: number; overageCents: number } | null;
  /** the donor's whole year against every configured bucket */
  donorYear: BucketResult[];
  options: ReallocationOption[];
}

export async function proposeReallocation(prisma: PrismaClient, contributionId: string): Promise<ReallocationProposal> {
  const contribution = await prisma.contribution.findUnique({ where: { id: contributionId } });
  if (!contribution) throw new ContributionNotFoundError(contributionId);
  if (contribution.status !== 'ACTIVE') throw new ContributionNotActiveError(contribution.id, contribution.status);

  const year = contributionYear(contribution.acceptedAt);
  const rows = await prisma.contribution.findMany({
    where: {
      contactId: contribution.contactId,
      status: 'ACTIVE',
      acceptedAt: { gte: new Date(Date.UTC(year - 1, 11, 30)), lt: new Date(Date.UTC(year + 1, 0, 2)) },
    },
  });
  const forLimits: ContributionForLimits[] = rows
    .filter((r) => contributionYear(r.acceptedAt) === year)
    .map((r) => ({
      id: r.id,
      amountCents: r.amountCents,
      goodsServices: r.goodsServices,
      entityKind: r.entityKind,
      ridingNumber: r.ridingNumber,
      year,
      candidateSelf: false,
      leadership: false,
    }));
  const limits = await prisma.contributionLimit.findMany({ where: { year } });
  const evaluation = evaluateLimits({ year, limits, contributions: forLimits });

  const current = evaluation.results.find((r) => r.contributionIds.includes(contribution.id));
  const overLimitBucket =
    current && current.overLimit
      ? {
          bucket: current.bucket,
          groupKey: current.groupKey,
          limitCents: current.limitCents,
          aggregateCents: current.aggregateCents,
          overageCents: current.overageCents,
        }
      : null;

  const options: ReallocationOption[] = [];
  if (overLimitBucket) {
    const limitFor = (bucket: string) => limits.find((l) => l.bucket === bucket)?.amountCents;
    const cap = (headroom: number) => Math.min(overLimitBucket.overageCents, headroom, contribution.amountCents);
    const partyLimit = limitFor('PARTY');
    const caLimit = limitFor('CA');
    const campaignLimit = limitFor('CAMPAIGN');

    if (current!.bucket !== 'PARTY' && partyLimit !== undefined) {
      const used = evaluation.results.find((r) => r.bucket === 'PARTY')?.aggregateCents ?? 0;
      const headroom = Math.max(0, partyLimit - used);
      if (headroom > 0) options.push({ entityKind: 'PARTY', ridingNumber: null, needsRiding: false, headroomCents: headroom, moveCents: cap(headroom) });
    }
    for (const [kind, limit] of [
      ['CA', caLimit],
      ['CAMPAIGN', campaignLimit],
    ] as const) {
      if (limit === undefined) continue;
      for (const r of evaluation.results.filter((x) => x.bucket === kind)) {
        if (r.groupKey === current!.groupKey) continue;
        const headroom = Math.max(0, limit - r.aggregateCents);
        if (headroom > 0) options.push({ entityKind: kind, ridingNumber: r.ridingNumber, needsRiding: false, headroomCents: headroom, moveCents: cap(headroom) });
      }
      // a riding the donor has not given to yet has the whole limit free
      options.push({ entityKind: kind, ridingNumber: null, needsRiding: true, headroomCents: limit, moveCents: cap(limit) });
    }
    options.sort((a, b) => b.moveCents - a.moveCents);
  }

  return {
    contributionId: contribution.id,
    contactId: contribution.contactId,
    year,
    amountCents: contribution.amountCents,
    overLimitBucket,
    donorYear: evaluation.results,
    options,
  };
}
