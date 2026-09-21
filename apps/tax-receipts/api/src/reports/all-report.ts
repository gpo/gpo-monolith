import { randomUUID } from 'node:crypto';
import {
  buildAllReportRow,
  formatAllReportCsv,
  type AllReportSourceRow,
} from '@gpo/tax-receipts-core';
import { storeArtifact } from '../artifacts/store.js';
import { withChangeLog } from '../changelog/write.js';
import type { EntityKind, PrismaClient } from '../generated/prisma/index.js';
import { loadReportReceipts, type ReportScope } from './load-receipts.js';

/**
 * ALL report generator (ticket 4.1): screens.md screen 10's per-entity file,
 * plus the combined all-entities file EO also expects (eo-reporting.md §2).
 * One generator serves both: omit `entityKind`/`ridingNumber` for the
 * combined file, supply them for one entity's own file. Column mapping and
 * derivations live in `@gpo/tax-receipts-core`'s `all-report.ts`
 * (pure/testable); this module is just the political-entity label wiring and
 * the artifact + EntityReport write on top of `load-receipts.ts`'s shared
 * fetch (also used by S2P2, ticket 4.2 — REP2 needs both reports to agree on
 * what's included).
 *
 * S2P2 (ticket 4.2) and the REP2-8 export gate (ticket 4.3) are separate
 * tickets — this generator does not block on validation findings; it reports
 * what is issued, at any status.
 */

export type { ReportScope as AllReportScope };
export {
  ReportScopeError as AllReportScopeError,
  MultiAllocationReceiptError,
  MissingContributionMetadataError,
} from './load-receipts.js';

export interface GenerateAllReportDeps {
  prisma: PrismaClient;
  storageDir: string;
}

export interface GenerateAllReportInput extends ReportScope {
  actorUserId: string;
  reason: string;
  /** Resolves a space's EO-facing display name (e.g. "084 Parry Sound
   *  Muskoka", "047 - Campaign to Elect Aislinn Clancy - 2025"). No entity-
   *  name registry exists in the schema yet — the same gap ticket 3.1/3.12
   *  already flagged for `politicalEntityLabel` on issuance — so this is
   *  caller-supplied rather than guessed on a document filed with a
   *  regulator. Called once per distinct (ridingNumber, entityKind) pair the
   *  scope's receipts actually carry. */
  politicalEntityLabel: (space: { ridingNumber: number | null; entityKind: EntityKind }) => string;
}

export interface GeneratedAllReport {
  entityReportId: string;
  artifactId: string;
  rowCount: number;
  csv: string;
}

export async function generateAllReport(
  deps: GenerateAllReportDeps,
  input: GenerateAllReportInput,
): Promise<GeneratedAllReport> {
  const { prisma } = deps;
  const loaded = await loadReportReceipts(prisma, input);

  const rows = loaded.map((row) => {
    const source: AllReportSourceRow = {
      receiptNumber: row.receiptNumber,
      status: row.status,
      entityKind: row.entityKind,
      periodId: row.periodId,
      issueDate: row.issueDate,
      amountCents: row.amountCents,
      acceptedAt: row.acceptedAt,
      goodsServices: row.goodsServices,
      receivedBy: row.receivedBy,
      eoContributorId: row.eoContributorId,
      contributorLastName: row.contributorLastName,
      contributorFirstName: row.contributorFirstName,
      addressLine1: row.addressLine1,
      city: row.city,
      province: row.province,
      postalCode: row.postalCode,
    };
    const label = input.politicalEntityLabel({ ridingNumber: row.ridingNumber, entityKind: row.entityKind });
    return buildAllReportRow(source, label);
  });

  const csv = formatAllReportCsv(rows);
  const artifact = await storeArtifact(deps, {
    kind: 'CSV',
    bytes: Buffer.from(csv, 'utf8'),
    extension: 'csv',
  });

  const correlationId = randomUUID();
  const entityReport = await withChangeLog(
    prisma,
    { userId: input.actorUserId, reason: input.reason, correlationId },
    async (ctx) => {
      const created = await ctx.tx.entityReport.create({
        data: {
          ridingNumber: input.ridingNumber ?? null,
          entityKind: input.entityKind ?? null,
          periodId: input.periodId,
          kind: 'ALL',
          artifactId: artifact.id,
          includedSet: { receiptIds: loaded.map((r) => r.receiptId) },
        },
      });
      await ctx.log({
        subjectType: 'EntityReport',
        subjectId: created.id,
        after: { artifactId: artifact.id, rowCount: rows.length, kind: 'ALL' },
      });
      if (loaded.length > 0) {
        await ctx.tx.entityReportReceipt.createMany({
          data: loaded.map((r) => ({ entityReportId: created.id, receiptId: r.receiptId })),
        });
      }
      return created;
    },
  );

  return { entityReportId: entityReport.id, artifactId: artifact.id, rowCount: rows.length, csv };
}
