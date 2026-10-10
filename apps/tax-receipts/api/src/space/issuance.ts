import {
  contributionYear,
  remainingEligibleCents,
  type AllocationRow,
} from '@gpo/tax-receipts-core';
import { advanceSpaceStage } from '../delivery/space-delivery.js';
import { issueCombinedReceipt, issueReceipt, type IssueReceiptDeps } from '../receipts/issue.js';
import type { PrismaClient, ReceiptDelivery } from '../generated/prisma/index.js';
import type { SpaceKey } from './space-state.js';

/**
 * Per-space issuance (ticket 3.12): screens.md screen 6's gate check +
 * pre-issuance preview + generate, for one space (period, riding, entity
 * kind) at a time. A generated receipt gets its delivery channel (the
 * donor's confirmed `DonorCyclePreference`, an override, or MAIL); sending
 * it is the wizard's next step (`delivery/`, ticket 3.6). A successful run
 * moves the space to `issued` on the W6 ladder.
 *
 * This deliberately reuses `issueReceipt` per contribution rather than
 * duplicating its invariant/kill-switch/change-log logic: a space is just
 * "every still-eligible contribution in this (period, riding, entity)
 * bucket," and by default one contribution means one receipt.
 *
 * With `combinePerDonor` (opt-in, EO evaluation rows 43 and 46), each
 * donor's contributions that may share a receipt (`receipts/combined.ts`:
 * same contribution type, agency status, and leadership contestant) become
 * one combined receipt via `issueCombinedReceipt`, so a monthly donor gets
 * one receipt for the period rather than twelve. They are also grouped by
 * calendar year, since the delivery preference is per donor per year.
 */

export interface SpaceIssuanceBlocker {
  workItemId: string;
  contributionId: string;
  contactId: string | null;
  contactName: string | null;
  kind: string;
  ruleRef: string | null;
}

/** Gate check: any OPEN work item on a contribution in this space blocks
 *  issuance for the whole space (the W6 ladder's "queue-clear" precondition,
 *  enforced live here rather than trusted from a possibly-stale
 *  `SpaceState.stage` — state-machine.ts is explicit that it enforces no
 *  gates of its own). */
export async function getSpaceIssuanceGate(
  prisma: PrismaClient,
  space: SpaceKey,
): Promise<SpaceIssuanceBlocker[]> {
  const contributionIds = await spaceContributionIds(prisma, space);
  if (contributionIds.length === 0) return [];

  const openItems = await prisma.workItem.findMany({
    where: { status: 'OPEN', subjectType: 'Contribution', subjectId: { in: contributionIds } },
    include: { contact: true },
    orderBy: [{ ruleRef: 'asc' }, { openedAt: 'asc' }],
  });
  return openItems.map((w) => ({
    workItemId: w.id,
    contributionId: w.subjectId,
    contactId: w.contactId,
    contactName: w.contact?.name ?? null,
    kind: w.kind,
    ruleRef: w.ruleRef,
  }));
}

/** One receipt the run would issue. */
export interface SpaceIssuanceLine {
  /** the first of `contributionIds` (kept for single-contribution callers) */
  contributionId: string;
  /** every contribution the receipt carries: one, or several when combined */
  contributionIds: string[];
  contactId: string;
  contactName: string;
  /** what would issue: the full remaining eligible amount of every
   *  contribution on the receipt (invariant 1) — this pass never issues a
   *  partial amount (that is a single-receipt override, ticket 3.1's own
   *  `amountCents` input). */
  amountCents: number;
  delivery: ReceiptDelivery;
}

async function spaceContributionIds(prisma: PrismaClient, space: SpaceKey): Promise<string[]> {
  const rows = await prisma.contribution.findMany({
    where: {
      status: 'ACTIVE',
      periodId: space.periodId,
      ridingNumber: space.ridingNumber,
      entityKind: space.entityKind,
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function spaceIssuanceLines(
  prisma: PrismaClient,
  space: SpaceKey,
  combinePerDonor: boolean,
): Promise<SpaceIssuanceLine[]> {
  const contributions = await prisma.contribution.findMany({
    where: {
      status: 'ACTIVE',
      periodId: space.periodId,
      ridingNumber: space.ridingNumber,
      entityKind: space.entityKind,
    },
    include: { contact: true, allocations: { include: { receipt: true } } },
    orderBy: [{ acceptedAt: 'asc' }, { id: 'asc' }],
  });

  const contactIds = [...new Set(contributions.map((c) => c.contactId))];
  const prefs =
    contactIds.length > 0
      ? await prisma.donorCyclePreference.findMany({ where: { contactId: { in: contactIds } } })
      : [];
  const prefByKey = new Map(prefs.map((p) => [`${p.contactId}:${p.year}`, p]));

  const lines: SpaceIssuanceLine[] = [];
  const combinedByKey = new Map<string, SpaceIssuanceLine>();
  for (const c of contributions) {
    const allocationRows: AllocationRow[] = c.allocations.map((a) => ({
      receiptId: a.receiptId,
      contributionId: a.contributionId,
      amountCents: a.amountCents,
      receiptStatus: a.receipt.status,
    }));
    const remaining = remainingEligibleCents(
      { id: c.id, amountCents: c.amountCents, nonDeductibleCents: c.nonDeductibleCents },
      allocationRows,
    );
    if (remaining <= 0) continue; // already fully receipted

    const year = contributionYear(c.acceptedAt);
    if (combinePerDonor) {
      const key = [c.contactId, year, c.goodsServices, c.receivedBy, c.leadershipContestantId].join(':');
      const combined = combinedByKey.get(key);
      if (combined) {
        combined.contributionIds.push(c.id);
        combined.amountCents += remaining;
        continue;
      }
    }
    const pref = prefByKey.get(`${c.contactId}:${year}`);
    const line: SpaceIssuanceLine = {
      contributionId: c.id,
      contributionIds: [c.id],
      contactId: c.contactId,
      contactName: c.contact.name,
      amountCents: remaining,
      delivery: pref?.delivery ?? 'MAIL',
    };
    lines.push(line);
    if (combinePerDonor) {
      combinedByKey.set([c.contactId, year, c.goodsServices, c.receivedBy, c.leadershipContestantId].join(':'), line);
    }
  }
  return lines;
}

export interface SpaceIssuanceTotals {
  receiptCount: number;
  amountCents: number;
  emailCount: number;
  mailCount: number;
}

export interface SpaceIssuancePreview {
  blocked: boolean;
  blockers: SpaceIssuanceBlocker[];
  lines: SpaceIssuanceLine[];
  totals: SpaceIssuanceTotals;
}

/** The wizard's gate check + pre-issuance preview (screens.md screen 6, O12):
 *  exactly what would issue, with nothing generated yet. Replaces trial
 *  receipts. When the gate is dirty, `lines` is empty — the queue has to
 *  clear before there is anything meaningful to preview. */
export async function previewSpaceIssuance(
  prisma: PrismaClient,
  space: SpaceKey,
  opts: { combinePerDonor?: boolean } = {},
): Promise<SpaceIssuancePreview> {
  const blockers = await getSpaceIssuanceGate(prisma, space);
  const lines = blockers.length === 0 ? await spaceIssuanceLines(prisma, space, opts.combinePerDonor ?? false) : [];
  const totals = lines.reduce<SpaceIssuanceTotals>(
    (acc, line) => {
      acc.receiptCount += 1;
      acc.amountCents += line.amountCents;
      if (line.delivery === 'EMAIL') acc.emailCount += 1;
      else acc.mailCount += 1;
      return acc;
    },
    { receiptCount: 0, amountCents: 0, emailCount: 0, mailCount: 0 },
  );
  return { blocked: blockers.length > 0, blockers, lines, totals };
}

export class SpaceIssuanceBlockedError extends Error {
  readonly statusCode = 409;
  constructor(readonly blockers: SpaceIssuanceBlocker[]) {
    super(
      `${blockers.length} open work item(s) block issuance for this space; resolve the queue first`,
    );
    this.name = 'SpaceIssuanceBlockedError';
  }
}

export interface IssueSpaceReceiptsInput extends SpaceKey {
  actorUserId: string;
  reason: string;
  /** the same "received by" display name for every receipt this call
   *  produces — one space is one entity, so unlike 3.1's per-contribution
   *  input, this is naturally a single value per call. */
  politicalEntityLabel: string;
  /** overrides every line's resolved delivery preference; omit to use each
   *  donor's `DonorCyclePreference` (defaulting to MAIL). */
  delivery?: ReceiptDelivery;
  /** one combined receipt per donor rather than one per contribution (see
   *  the header comment); off by default */
  combinePerDonor?: boolean;
}

export interface SpaceIssuanceRowResult {
  contributionId: string;
  contributionIds: string[];
  ok: boolean;
  receiptId?: string;
  receiptNumber?: string;
  amountCents?: number;
  error?: string;
}

export interface SpaceIssuanceResult {
  results: SpaceIssuanceRowResult[];
  succeeded: number;
  failed: number;
}

/** Generate: issues one receipt per still-eligible contribution in the
 *  space. Per-row failures (a missing address, a race against invariant 1)
 *  don't stop the rest — the same "full result set after the batch
 *  completes" shape as bulk-edit (ticket 1.4) — but the gate itself is
 *  all-or-nothing: an open work item anywhere in the space blocks the whole
 *  run, not just its own contribution. Repeatable for stragglers (W4): a
 *  contribution that clears its item, or arrives late, is simply eligible
 *  on the next call. */
export async function issueReceiptsForSpace(
  deps: IssueReceiptDeps,
  input: IssueSpaceReceiptsInput,
): Promise<SpaceIssuanceResult> {
  const space: SpaceKey = {
    periodId: input.periodId,
    ridingNumber: input.ridingNumber,
    entityKind: input.entityKind,
  };
  const blockers = await getSpaceIssuanceGate(deps.prisma, space);
  if (blockers.length > 0) throw new SpaceIssuanceBlockedError(blockers);

  const lines = await spaceIssuanceLines(deps.prisma, space, input.combinePerDonor ?? false);
  const results: SpaceIssuanceRowResult[] = [];
  for (const line of lines) {
    try {
      const common = {
        actorUserId: input.actorUserId,
        reason: input.reason,
        delivery: input.delivery ?? line.delivery,
        politicalEntityLabel: input.politicalEntityLabel,
      };
      const receipt =
        line.contributionIds.length > 1
          ? await issueCombinedReceipt(deps, { ...common, contributionIds: line.contributionIds })
          : await issueReceipt(deps, { ...common, contributionId: line.contributionId });
      results.push({
        contributionId: line.contributionId,
        contributionIds: line.contributionIds,
        ok: true,
        receiptId: receipt.id,
        receiptNumber: receipt.receiptNumber,
        amountCents: receipt.amountCents,
      });
    } catch (err) {
      results.push({
        contributionId: line.contributionId,
        contributionIds: line.contributionIds,
        ok: false,
        error: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }
  const succeeded = results.filter((r) => r.ok).length;
  if (succeeded > 0) await advanceSpaceStage(deps.prisma, space, 'issued');
  return { results, succeeded, failed: results.length - succeeded };
}
