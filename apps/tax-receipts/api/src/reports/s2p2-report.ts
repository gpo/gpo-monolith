import { randomUUID } from 'node:crypto';
import {
  buildS2p2Rows,
  formatS2p2Csv,
  type S2p2SourceRow,
} from '@gpo/tax-receipts-core';
import { storeArtifact } from '../artifacts/store.js';
import { withChangeLog } from '../changelog/write.js';
import type { EntityKind, PrismaClient } from '../generated/prisma/index.js';
import { loadReportReceipts, type ReportScope } from './load-receipts.js';

/**
 * S2P2 report generator (ticket 4.2): Schedule 2 Part 2, the per-entity
 * aggregate of over-$200 contributors. Same scope/loading as the ALL
 * generator (ticket 4.1, `load-receipts.ts`) — REP2 needs both reports to
 * agree on what's included. Aggregation and column mapping live in
 * `@gpo/tax-receipts-core`'s `s2p2-report.ts` (pure/testable); this module
 * is the political-entity label wiring and the artifact + EntityReport
 * write, EXCEPT when nothing in scope clears the $200 threshold — then no
 * artifact or EntityReport is written at all (eo-reporting.md §2: "a period
 * whose top aggregate does not exceed $200 emits no S2P2 file at all").
 */

export interface GenerateS2p2ReportDeps {
  prisma: PrismaClient;
  storageDir: string;
}

export interface GenerateS2p2ReportInput extends ReportScope {
  actorUserId: string;
  reason: string;
  /** same resolver shape as the ALL generator's — a single resolver can be
   *  shared between both calls for the same scope. */
  politicalEntityLabel: (space: { ridingNumber: number | null; entityKind: EntityKind }) => string;
}

export interface GeneratedS2p2Report {
  /** null when nothing in scope clears the $200 threshold — no file exists,
   *  not an empty one; no `Artifact` or `EntityReport` row is written. */
  entityReportId: string | null;
  artifactId: string | null;
  rowCount: number;
  csv: string | null;
}

export async function generateS2p2Report(
  deps: GenerateS2p2ReportDeps,
  input: GenerateS2p2ReportInput,
): Promise<GeneratedS2p2Report> {
  const { prisma } = deps;
  const loaded = await loadReportReceipts(prisma, input);

  const sources: S2p2SourceRow[] = loaded.map((row) => ({
    status: row.status,
    entityKind: row.entityKind,
    ridingNumber: row.ridingNumber,
    periodId: row.periodId,
    amountCents: row.amountCents,
    contactId: row.contactId,
    eoContributorId: row.eoContributorId,
    contributorLastName: row.contributorLastName,
    contributorFirstName: row.contributorFirstName,
    addressLine1: row.addressLine1,
    city: row.city,
    province: row.province,
    postalCode: row.postalCode,
    receiptId: row.receiptId,
  }));

  const { rows, includedReceiptIds } = buildS2p2Rows(sources, input.politicalEntityLabel);

  if (rows.length === 0) {
    return { entityReportId: null, artifactId: null, rowCount: 0, csv: null };
  }

  const csv = formatS2p2Csv(rows);
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
          kind: 'S2P2',
          artifactId: artifact.id,
          includedSet: { receiptIds: includedReceiptIds },
        },
      });
      await ctx.log({
        subjectType: 'EntityReport',
        subjectId: created.id,
        after: { artifactId: artifact.id, rowCount: rows.length, kind: 'S2P2' },
      });
      if (includedReceiptIds.length > 0) {
        await ctx.tx.entityReportReceipt.createMany({
          data: includedReceiptIds.map((receiptId) => ({ entityReportId: created.id, receiptId })),
        });
      }
      return created;
    },
  );

  return { entityReportId: entityReport.id, artifactId: artifact.id, rowCount: rows.length, csv };
}
