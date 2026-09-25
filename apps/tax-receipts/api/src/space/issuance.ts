import {
  contributionYear,
  remainingEligibleCents,
  type AllocationRow,
} from '@gpo/tax-receipts-core';
import { issueReceipt, type IssueReceiptDeps } from '../receipts/issue.js';
import type { PrismaClient, ReceiptDelivery } from '../generated/prisma/index.js';
import type { SpaceKey } from './space-state.js';

/**
 * Per-space issuance (ticket 3.12, first slice): screens.md screen 6's gate
 * check + pre-issuance preview + generate, for one space (period, riding,
 * entity kind) at a time. Delivery (email/print, Qomon activity logging,
 * donor pre-check) is out of scope here — those are tickets 3.5/3.6/3.9,
 * still open — so a generated receipt gets its default delivery (the
 * donor's confirmed `DonorCyclePreference`, or MAIL) but nothing is actually
 * sent yet; that is the same gap 3.1 already left (its PDF-only note 5).
 *
 * This deliberately reuses `issueReceipt` per contribution rather than
 * duplicating its invariant/kill-switch/change-log logic: a space is just
 * "every still-eligible contribution in this (period, riding, entity)
 * bucket," and one contribution still means one receipt (3.1's scoping,
 * unchanged here).
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

export interface SpaceIssuanceLine {
  contributionId: string;
  contactId: string;
  contactName: string;
  /** what would issue: the contribution's full remaining eligible amount
   *  (invariant 1) — this pass never issues a partial amount (that is a
   *  single-receipt override, ticket 3.1's own `amountCents` input). */
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

async function spaceIssuanceLines(prisma: PrismaClient, space: SpaceKey): Promise<SpaceIssuanceLine[]> {
  const contributions = await prisma.contribution.findMany({
    where: {
      status: 'ACTIVE',
      periodId: space.periodId,
      ridingNumber: space.ridingNumber,
      entityKind: space.entityKind,
    },
    include: { contact: true, allocations: { include: { receipt: true } } },
  });

  const contactIds = [...new Set(contributions.map((c) => c.contactId))];
  const prefs =
    contactIds.length > 0
      ? await prisma.donorCyclePreference.findMany({ where: { contactId: { in: contactIds } } })
      : [];
  const prefByKey = new Map(prefs.map((p) => [`${p.contactId}:${p.year}`, p]));

  const lines: SpaceIssuanceLine[] = [];
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

    const pref = prefByKey.get(`${c.contactId}:${contributionYear(c.acceptedAt)}`);
    lines.push({
      contributionId: c.id,
      contactId: c.contactId,
      contactName: c.contact.name,
      amountCents: remaining,
      delivery: pref?.delivery ?? 'MAIL',
    });
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
): Promise<SpaceIssuancePreview> {
  const blockers = await getSpaceIssuanceGate(prisma, space);
  const lines = blockers.length === 0 ? await spaceIssuanceLines(prisma, space) : [];
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
}

export interface SpaceIssuanceRowResult {
  contributionId: string;
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

  const lines = await spaceIssuanceLines(deps.prisma, space);
  const results: SpaceIssuanceRowResult[] = [];
  for (const line of lines) {
    try {
      const receipt = await issueReceipt(deps, {
        contributionId: line.contributionId,
        actorUserId: input.actorUserId,
        reason: input.reason,
        delivery: input.delivery ?? line.delivery,
        politicalEntityLabel: input.politicalEntityLabel,
      });
      results.push({
        contributionId: line.contributionId,
        ok: true,
        receiptId: receipt.id,
        receiptNumber: receipt.receiptNumber,
        amountCents: receipt.amountCents,
      });
    } catch (err) {
      results.push({
        contributionId: line.contributionId,
        ok: false,
        error: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }
  const succeeded = results.filter((r) => r.ok).length;
  return { results, succeeded, failed: results.length - succeeded };
}
