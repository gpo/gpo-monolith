import {
  RTD_FILING_PARTY_ID,
  buildRtdFilingName,
  buildRtdFilingRow,
  formatRtdFilingCsv,
  formatRtdFilingPipe,
} from '@gpo/tax-receipts-core';
import { storeArtifact, type ArtifactStoreDeps } from '../artifacts/store.js';
import { withChangeLog } from '../changelog/write.js';
import type { PrismaClient } from '../generated/prisma/index.js';
import { buildRtdDraft, type RtdGateFinding } from './draft.js';

/**
 * RTD filing prepare step (redesigned from tickets 2.3 "stamp" + 2.6
 * "archive"): given a filer's selection of the draft's rows, re-derives the
 * draft fresh (never trusts a client-supplied snapshot -- the same choice
 * `space/issuance.ts`'s gate and `reports/load-receipts.ts`'s REP4/REP6 gate
 * already make), gate-checks the selection, and in one pass produces both a
 * new `RtdFiling` + one `RtdInclusion` row per contribution AND the actual
 * CSV/pipe artifact EO will eventually receive.
 *
 * Deliberately does NOT mark the filing as sent to EO: `RtdFiling.submittedAt`
 * /`submittedBy` stay null until `markRtdFilingSent` (`mark-sent.ts`) runs, a
 * separate, later, human-confirmed step. This is the fix for a real gap the
 * original two-step (stamp-then-archive) design had: stamping used to flip
 * the reported-marker that `isReceiptedOrReported`
 * (`contributions/metadata-cache.ts`) and the mirror sweep's diff-queue
 * routing check -- before a file even existed, let alone before anyone sent
 * it to EO. Preparing still creates the `RtdInclusion` rows immediately (so
 * `isReceiptedOrReported` keeps blocking casual edits to a row that's
 * already locked into a pending filing's rendered bytes -- editing it now
 * would silently desync the artifact from the data), but nothing is treated
 * as "EO has seen this" until the separate send confirmation.
 *
 * On rule E2 ("edit to an RTD-reported contribution has a matching
 * owed-to-EO item", Gate: RTD export): E2 cannot fire on anything this
 * function prepares, for the same reason stamp.ts originally documented --
 * `buildRtdDraft` only ever returns rows for never-before-included
 * contributions, so a fresh filing's candidate rows are structurally never
 * "already reported." E2's real subject belongs to the correction-action
 * flow (corrections.md action 11, ticket 3.10) and DC-1A generation
 * (`dc1a.ts`), not this step.
 */

export class RtdPrepareSelectionError extends Error {
  readonly statusCode = 400;
  constructor(readonly missingContributionIds: string[]) {
    super(
      missingContributionIds.length === 0
        ? 'no contributions selected to prepare'
        : `${missingContributionIds.length} selected contribution(s) are not in the current RTD draft ` +
          `(already prepared or reported, no longer eligible, or never were a candidate): ${missingContributionIds.join(', ')}`,
    );
    this.name = 'RtdPrepareSelectionError';
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

/** A race: another prepare claimed one of these contributions between the
 *  draft re-derivation above and this transaction's write. */
export class RtdAlreadyIncludedError extends Error {
  readonly statusCode = 409;
  constructor(readonly contributionIds: string[]) {
    super(`already included in another RTD filing: ${contributionIds.join(', ')}`);
    this.name = 'RtdAlreadyIncludedError';
  }
}

export interface PrepareRtdFilingDeps extends ArtifactStoreDeps {
  prisma: PrismaClient;
}

export interface PrepareRtdFilingInput {
  /** the RTD disclosure year (matches `RtdDraftInput.year`). */
  year: number;
  /** which of the current draft's rows to include in this filing -- lets a
   *  filer hold a gate-blocked row back rather than preparing nothing at
   *  all. Every id must be a contribution currently in the draft. */
  contributionIds: readonly string[];
  actorUserId: string;
  reason: string;
  /** RTD configuration (eo-reporting.md §1: "CFO name is configuration, not
   *  a hardcoded constant"); no `RtdConfig` model exists yet, so this is
   *  caller-supplied -- the same gap-handling `politicalEntityLabel` takes
   *  on issuance/reporting (open-questions.md O39). Captured here, at
   *  prepare time, rather than later: it's baked into the rendered artifact
   *  immediately. */
  cfoName: string;
  /** defaults to now; also the instant the filing name's timestamp and the
   *  draft's business-day clock are evaluated as of. */
  asOf?: Date;
  /** `.csv` or pipe-delimited `.txt` (eo-reporting.md §1); defaults to CSV. */
  format?: 'CSV' | 'PIPE';
}

export interface PreparedRtdFiling {
  rtdFilingId: string;
  filingName: string;
  preparedCount: number;
  artifactId: string;
  sha256: string;
  byteSize: number;
}

export async function prepareRtdFiling(
  deps: PrepareRtdFilingDeps,
  input: PrepareRtdFilingInput,
): Promise<PreparedRtdFiling> {
  const { prisma } = deps;
  if (input.contributionIds.length === 0) {
    throw new RtdPrepareSelectionError([]);
  }
  const asOf = input.asOf ?? new Date();

  const draft = await buildRtdDraft(prisma, { year: input.year, asOf });
  const byContributionId = new Map(draft.rows.map((r) => [r.contributionId, r]));

  const missing = input.contributionIds.filter((id) => !byContributionId.has(id));
  if (missing.length > 0) throw new RtdPrepareSelectionError(missing);

  const selected = input.contributionIds.map((id) => byContributionId.get(id)!);
  const blocked = selected.filter((r) => r.gateFindings.length > 0);
  if (blocked.length > 0) {
    throw new RtdExportBlockedError(
      blocked.map((r) => ({ contributionId: r.contributionId, gateFindings: r.gateFindings })),
    );
  }

  const filingName = buildRtdFilingName(input.year, RTD_FILING_PARTY_ID, asOf);
  const format = input.format ?? 'CSV';

  const ordered = [...selected].sort((a, b) => a.acceptedAt.getTime() - b.acceptedAt.getTime());
  const rows = ordered.map((row) =>
    buildRtdFilingRow(
      {
        contributionYear: row.contributionYear,
        periodId: row.periodId,
        contributorLastName: row.contactLastName,
        contributorFirstName: row.contactFirstName,
        acceptedAt: row.acceptedAt,
        amountCents: row.amountCents,
        aggregateAfterCents: row.aggregateAfterCents,
        eoContributorId: row.eoContributorId,
      },
      input.cfoName,
    ),
  );
  const isPipe = format === 'PIPE';
  const text = isPipe ? formatRtdFilingPipe(rows) : formatRtdFilingCsv(rows);
  const artifact = await storeArtifact(deps, {
    kind: 'CSV',
    bytes: Buffer.from(text, 'utf8'),
    extension: isPipe ? 'txt' : 'csv',
  });

  const rtdFilingId = await withChangeLog(
    prisma,
    { userId: input.actorUserId, reason: input.reason },
    async (ctx) => {
      const alreadyIncluded = await ctx.tx.rtdInclusion.findMany({
        where: { contributionId: { in: selected.map((r) => r.contributionId) } },
        select: { contributionId: true },
      });
      if (alreadyIncluded.length > 0) {
        throw new RtdAlreadyIncludedError(alreadyIncluded.map((r) => r.contributionId));
      }

      const filing = await ctx.tx.rtdFiling.create({
        data: { name: filingName, kind: 'INITIAL', format, artifactId: artifact.id },
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
        after: {
          name: filing.name,
          kind: filing.kind,
          rowCount: selected.length,
          artifactId: artifact.id,
          sha256: artifact.sha256,
        },
      });
      return filing.id;
    },
  );

  return {
    rtdFilingId,
    filingName,
    preparedCount: selected.length,
    artifactId: artifact.id,
    sha256: artifact.sha256,
    byteSize: artifact.byteSize ?? text.length,
  };
}
