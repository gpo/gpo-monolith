import {
  buildRtdFilingRow,
  contributionYear,
  formatRtdFilingCsv,
  formatRtdFilingPipe,
} from '@gpo/tax-receipts-core';
import { storeArtifact, type ArtifactStoreDeps } from '../artifacts/store.js';
import { withChangeLog } from '../changelog/write.js';
import type { PrismaClient } from '../generated/prisma/index.js';

/**
 * RTD filing archive (ticket 2.6): renders an already-stamped `RtdFiling`
 * (ticket 2.3) into its CSV or pipe-delimited bytes, stores them
 * content-addressed with a sha256 hash (`storeArtifact`, ticket 3.1 — the
 * same helper the ALL/S2P2 report generators use), and records the artifact
 * on the filing. A separate step from stamping on purpose: stamping commits
 * which contributions are reported and their aggregates (the data EO cares
 * about); archiving renders that data into the actual file EO receives.
 *
 * Only for `RtdFiling.kind = INITIAL` today: a DC1A_AMENDMENT filing's
 * content is a Form DC-1A (original details + reason), not a row listing —
 * a different shape entirely (ticket 2.4).
 */

export class RtdFilingNotFoundError extends Error {
  constructor(readonly rtdFilingId: string) {
    super(`no RtdFiling ${rtdFilingId}`);
    this.name = 'RtdFilingNotFoundError';
  }
}

/** A filing's artifact never changes once archived (the whole system's
 *  never-overwrite-a-filed-artifact rule, compliance.md) — re-running this
 *  is a caller bug, not a resync. */
export class RtdFilingAlreadyArchivedError extends Error {
  constructor(readonly rtdFilingId: string, readonly artifactId: string) {
    super(`RtdFiling ${rtdFilingId} is already archived as artifact ${artifactId}`);
    this.name = 'RtdFilingAlreadyArchivedError';
  }
}

export class UnsupportedFilingKindError extends Error {
  constructor(readonly rtdFilingId: string, readonly kind: string) {
    super(`RtdFiling ${rtdFilingId} has kind ${kind}; archiveRtdFiling only renders INITIAL filings (ticket 2.4 covers DC1A_AMENDMENT)`);
    this.name = 'UnsupportedFilingKindError';
  }
}

export interface ArchiveRtdFilingDeps extends ArtifactStoreDeps {
  prisma: PrismaClient;
}

export interface ArchiveRtdFilingInput {
  rtdFilingId: string;
  /** RTD configuration (eo-reporting.md §1: "CFO name is configuration, not
   *  a hardcoded constant"); no `RtdConfig` model exists yet, so this is
   *  caller-supplied — the same gap-handling `politicalEntityLabel` takes
   *  on issuance/reporting (open-questions.md O39). */
  cfoName: string;
  actorUserId: string;
  reason: string;
}

export interface ArchivedRtdFiling {
  artifactId: string;
  sha256: string;
  byteSize: number;
}

export async function archiveRtdFiling(
  deps: ArchiveRtdFilingDeps,
  input: ArchiveRtdFilingInput,
): Promise<ArchivedRtdFiling> {
  const filing = await deps.prisma.rtdFiling.findUnique({
    where: { id: input.rtdFilingId },
    include: {
      inclusions: {
        include: { contribution: { include: { contact: true, metadata: true } } },
      },
    },
  });
  if (!filing) throw new RtdFilingNotFoundError(input.rtdFilingId);
  if (filing.artifactId) throw new RtdFilingAlreadyArchivedError(input.rtdFilingId, filing.artifactId);
  if (filing.kind !== 'INITIAL') throw new UnsupportedFilingKindError(input.rtdFilingId, filing.kind);

  const ordered = [...filing.inclusions].sort(
    (a, b) => a.contribution.acceptedAt.getTime() - b.contribution.acceptedAt.getTime(),
  );

  const rows = ordered.map((inclusion) => {
    const { contribution } = inclusion;
    const metadata = contribution.metadata;
    if (!metadata) {
      throw new Error(
        `contribution ${contribution.id} (RtdInclusion ${inclusion.id}) has no metadata — unreachable given ` +
          'ticket 2.2/2.3 only ever stamp metadata-backed candidates',
      );
    }
    return buildRtdFilingRow(
      {
        contributionYear: contributionYear(contribution.acceptedAt),
        periodId: metadata.periodId,
        contributorLastName: contribution.contact.lastName ?? contribution.contact.name,
        contributorFirstName: contribution.contact.firstName ?? '',
        acceptedAt: contribution.acceptedAt,
        amountCents: inclusion.amountCents,
        aggregateAfterCents: inclusion.aggregateAfterCents,
        eoContributorId: metadata.eoContributorId,
      },
      input.cfoName,
    );
  });

  const isPipe = filing.format === 'PIPE';
  const text = isPipe ? formatRtdFilingPipe(rows) : formatRtdFilingCsv(rows);
  const artifact = await storeArtifact(deps, {
    kind: 'CSV',
    bytes: Buffer.from(text, 'utf8'),
    extension: isPipe ? 'txt' : 'csv',
  });

  await withChangeLog(deps.prisma, { userId: input.actorUserId, reason: input.reason }, async (ctx) => {
    const after = await ctx.tx.rtdFiling.update({
      where: { id: input.rtdFilingId },
      data: { artifactId: artifact.id },
    });
    await ctx.log({
      subjectType: 'RtdFiling',
      subjectId: input.rtdFilingId,
      after: { artifactId: artifact.id, sha256: artifact.sha256, rowCount: rows.length },
    });
    return after;
  });

  return { artifactId: artifact.id, sha256: artifact.sha256, byteSize: artifact.byteSize ?? text.length };
}
