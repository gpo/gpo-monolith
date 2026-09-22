import { RTD_FILING_PARTY_ID, buildRtdFilingName } from '@gpo/tax-receipts-core';
import { withChangeLog } from '../changelog/write.js';
import type { PrismaClient } from '../generated/prisma/index.js';
import { buildRtdDraft, type RtdGateFinding } from './draft.js';

/**
 * RTD filing stamp (ticket 2.3): turns a filer's selection of ticket 2.2's
 * draft rows into a real `RtdFiling` + one `RtdInclusion` row per
 * contribution, in a single change-logged transaction. This is what
 * `RtdInclusion` "stamping" means, and it's what makes invariant 6
 * (data-model.md §2) meaningful for the first time — `isReceiptedOrReported`
 * (`contributions/metadata-cache.ts`, ticket 1.2) and the mirror sweep's
 * diff-queue routing (`sync/mirror-sweep.ts`, ticket 1.1) both already check
 * for an existing `RtdInclusion`; before this ticket, that check could never
 * be true, because nothing ever wrote one.
 *
 * The draft is re-derived fresh from `buildRtdDraft` rather than trusting a
 * client-supplied snapshot — the same "live recompute, don't trust a cached
 * flag" choice `space/issuance.ts`'s gate and `reports/load-receipts.ts`'s
 * REP4/REP6 gate already made.
 *
 * On rule E2 ("edit to an RTD-reported contribution has a matching
 * owed-to-EO item", Gate: RTD export): E2 cannot fire on anything this
 * function stamps. Ticket 2.2's `buildRtdDraftRows` only ever returns rows
 * for contributions with `alreadyReported: false` — a fresh filing's
 * candidate rows are, by construction, never-before-reported — so E2 is
 * structurally vacuous for THIS gate, the same way `reports/rep-gate.ts`
 * documents REP1/REP3/REP7/REP8 as "structurally guaranteed elsewhere,
 * nothing left for this gate to catch". E2's real subject — a contribution
 * that WAS already reported and has since changed — belongs to the
 * correction-action flow (corrections.md action 11, "Retract from EO
 * (DC-1A)", ticket 3.10) and DC-1A generation (ticket 2.4), not a new
 * filing's stamp.
 *
 * Does not generate or store a CSV/pipe artifact — that's ticket 2.6
 * ("filing archive with content hash"), a separate step on top of an
 * already-stamped `RtdFiling`.
 */

export class RtdStampSelectionError extends Error {
  readonly statusCode = 400;
  constructor(readonly missingContributionIds: string[]) {
    super(
      missingContributionIds.length === 0
        ? 'no contributions selected to stamp'
        : `${missingContributionIds.length} selected contribution(s) are not in the current RTD draft ` +
          `(already reported, no longer eligible, or never were a candidate): ${missingContributionIds.join(', ')}`,
    );
    this.name = 'RtdStampSelectionError';
  }
}

/** The RTD-export gate (eo-reporting.md §1: "RTD export runs rules A1, C4,
 *  B1, B2, E2 on candidate rows") found an open finding on a selected row. */
export class RtdExportBlockedError extends Error {
  readonly statusCode = 409;
  constructor(readonly blocked: Array<{ contributionId: string; gateFindings: RtdGateFinding[] }>) {
    super(
      `${blocked.length} row(s) have open RTD-gate findings blocking this filing: ` +
        blocked
          .map((b) => `${b.contributionId} (${b.gateFindings.map((f) => f.ruleRef).join(',')})`)
          .join('; '),
    );
    this.name = 'RtdExportBlockedError';
  }
}

/** A race: another stamp reported one of these contributions between the
 *  draft re-derivation above and this transaction's write. */
export class RtdAlreadyReportedError extends Error {
  readonly statusCode = 409;
  constructor(readonly contributionIds: string[]) {
    super(`already has an RtdInclusion row: ${contributionIds.join(', ')}`);
    this.name = 'RtdAlreadyReportedError';
  }
}

export interface StampRtdFilingInput {
  /** the RTD disclosure year (matches `RtdDraftInput.year`). */
  year: number;
  /** which of the current draft's rows to include in this filing — lets a
   *  filer hold a gate-blocked row back rather than stamping nothing at
   *  all. Every id must be a contribution currently in the draft. */
  contributionIds: readonly string[];
  actorUserId: string;
  reason: string;
  /** defaults to now; also the instant the filing name's timestamp and the
   *  draft's business-day clock are evaluated as of. */
  asOf?: Date;
  /** `.csv` or pipe-delimited `.txt` (eo-reporting.md §1); defaults to CSV.
   *  Only affects how ticket 2.6's `archiveRtdFiling` later renders the
   *  bytes — this ticket never generates them. */
  format?: 'CSV' | 'PIPE';
}

export interface StampedRtdFiling {
  rtdFilingId: string;
  filingName: string;
  stampedCount: number;
}

export async function stampRtdFiling(
  prisma: PrismaClient,
  input: StampRtdFilingInput,
): Promise<StampedRtdFiling> {
  if (input.contributionIds.length === 0) {
    throw new RtdStampSelectionError([]);
  }
  const asOf = input.asOf ?? new Date();

  const draft = await buildRtdDraft(prisma, { year: input.year, asOf });
  const byContributionId = new Map(draft.rows.map((r) => [r.contributionId, r]));

  const missing = input.contributionIds.filter((id) => !byContributionId.has(id));
  if (missing.length > 0) throw new RtdStampSelectionError(missing);

  const selected = input.contributionIds.map((id) => byContributionId.get(id)!);
  const blocked = selected.filter((r) => r.gateFindings.length > 0);
  if (blocked.length > 0) {
    throw new RtdExportBlockedError(
      blocked.map((r) => ({ contributionId: r.contributionId, gateFindings: r.gateFindings })),
    );
  }

  const filingName = buildRtdFilingName(input.year, RTD_FILING_PARTY_ID, asOf);

  const rtdFilingId = await withChangeLog(
    prisma,
    { userId: input.actorUserId, reason: input.reason },
    async (ctx) => {
      const alreadyReported = await ctx.tx.rtdInclusion.findMany({
        where: { contributionId: { in: selected.map((r) => r.contributionId) } },
        select: { contributionId: true },
      });
      if (alreadyReported.length > 0) {
        throw new RtdAlreadyReportedError(alreadyReported.map((r) => r.contributionId));
      }

      const filing = await ctx.tx.rtdFiling.create({
        data: { name: filingName, kind: 'INITIAL', format: input.format ?? 'CSV' },
      });
      await ctx.tx.rtdInclusion.createMany({
        data: selected.map((r) => ({
          contributionId: r.contributionId,
          rtdFilingId: filing.id,
          amountCents: r.amountCents,
          aggregateAfterCents: r.aggregateAfterCents,
        })),
      });
      await ctx.log({
        subjectType: 'RtdFiling',
        subjectId: filing.id,
        after: { name: filing.name, kind: filing.kind, rowCount: selected.length },
      });
      return filing.id;
    },
  );

  return { rtdFilingId, filingName, stampedCount: selected.length };
}
