import {
  buildAllReportRow,
  buildS2p2Rows,
  diffReportRows,
  type AllReportRow,
  type ReportRowDiffResult,
  type S2p2Row,
} from '@gpo/tax-receipts-core';
import { withChangeLog } from '../changelog/write.js';
import type { EntityKind, EntityReportKind, PrismaClient } from '../generated/prisma/index.js';
import { loadReportReceipts, ReportExportBlockedError, type EntityReportIncludedSet } from './load-receipts.js';

/**
 * Entity reports screen (ticket 4.5, screens.md screen 10): list generated
 * ALL/S2P2 reports for a period, with a live-computed dirty status (rule
 * E5) and, per report, the field-level diff screens.md asks for ("exactly
 * which included records changed and why").
 *
 * The dirty check is a read-time recompute, not a write-time flag
 * maintained by hooks scattered across every mutation that could touch a
 * reported row (metadata edits, a future correction action, a Qomon
 * refresh) — the same "recompute live rather than trust stale state" idiom
 * `space/issuance.ts`'s gate already uses. `EntityReport.dirty` (the
 * schema's own boolean column) is left unused for now; nothing persists a
 * dirty flag back, so it stays `false` in the database. A future ticket
 * that wants a cheap, indexable "which reports are dirty" query without a
 * live recompute per row would be the place to start writing it back.
 *
 * Scope cut: drift-checking only covers per-entity reports (`entityKind`
 * non-null). A combined report's rows span many different political
 * entities with no single label to rebuild against without guessing —
 * O39's entity-name-registry gap, not solved here — so combined reports
 * report `dirty: null` ("not checked") rather than a wrong answer.
 */

export interface EntityReportSummary {
  id: string;
  kind: EntityReportKind;
  periodId: number;
  ridingNumber: number | null;
  entityKind: EntityKind | null;
  generatedAt: Date;
  sentToCfoAt: Date | null;
  artifactId: string | null;
  rowCount: number;
  /** null = combined report, not drift-checked (see this file's header
   *  comment); otherwise true iff at least one included row's rendered
   *  fields differ from what's on file now (rule E5). */
  dirty: boolean | null;
}

function parseIncludedSet<Row>(value: unknown): EntityReportIncludedSet<Row> {
  if (value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).rows)) {
    return value as EntityReportIncludedSet<Row>;
  }
  return { receiptIds: [], rows: [] };
}

function rowKeyOf(kind: EntityReportKind, row: Record<string, string | number>): string {
  if (kind === 'ALL') return String(row.Receipt_Number);
  // S2P2 rows are per-(contributor, entity) aggregates, not per-receipt --
  // there is no single stable id column, so key on the fields that define
  // the group (research/fixtures/README.md's aggregation rule).
  return `${row.Political_Entity_Type}:${row.Political_Entity}:${row.Contributor_Last_Name}:${row.Contributor_First_Name}`;
}

/**
 * Rebuilds a per-entity report's rows fresh, right now, reusing the label
 * every stored row already carries (one space has one label; no new
 * resolver input is needed to check for drift, only to generate a brand
 * new report). Returns `null` when the report's own scope is currently
 * blocked by the REP4/REP6 gate (e.g. a period was edited after
 * generation) -- that's a real problem, but a different one than "dirty",
 * so the caller surfaces it distinctly rather than crashing the list.
 */
async function rebuildCurrentRows(
  prisma: PrismaClient,
  report: { kind: EntityReportKind; periodId: number; ridingNumber: number | null; entityKind: EntityKind | null },
  storedRows: readonly Record<string, string | number>[],
): Promise<Record<string, string | number>[] | 'blocked'> {
  if (report.entityKind === null) return []; // combined: not drift-checked (see header comment)
  const label = String(storedRows[0]?.Political_Entity ?? '');

  let loaded;
  try {
    loaded = await loadReportReceipts(prisma, {
      periodId: report.periodId,
      ridingNumber: report.ridingNumber,
      entityKind: report.entityKind,
    });
  } catch (err) {
    if (err instanceof ReportExportBlockedError) return 'blocked';
    throw err;
  }

  if (report.kind === 'ALL') {
    return loaded.rows.map((row) =>
      buildAllReportRow(
        {
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
        },
        label,
      ),
    );
  }

  const { rows } = buildS2p2Rows(
    loaded.rows.map((row) => ({
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
    })),
    () => label,
  );
  return rows;
}

export interface EntityReportDrift {
  status: 'clean' | 'dirty' | 'blocked' | 'not-checked';
  diff: ReportRowDiffResult<Record<string, string | number>> | null;
}

export async function checkEntityReportDrift(
  prisma: PrismaClient,
  report: {
    kind: EntityReportKind;
    periodId: number;
    ridingNumber: number | null;
    entityKind: EntityKind | null;
    includedSet: unknown;
  },
): Promise<EntityReportDrift> {
  if (report.entityKind === null) return { status: 'not-checked', diff: null };

  const stored = parseIncludedSet<AllReportRow | S2p2Row>(report.includedSet);
  const current = await rebuildCurrentRows(prisma, report, stored.rows);
  if (current === 'blocked') return { status: 'blocked', diff: null };

  const diff = diffReportRows(stored.rows, current, (row) => rowKeyOf(report.kind, row));
  return { status: diff.changed.length > 0 ? 'dirty' : 'clean', diff };
}

export async function listEntityReports(
  prisma: PrismaClient,
  periodId: number,
): Promise<EntityReportSummary[]> {
  const reports = await prisma.entityReport.findMany({
    where: { periodId },
    orderBy: { generatedAt: 'desc' },
  });

  return Promise.all(
    reports.map(async (r): Promise<EntityReportSummary> => {
      const stored = parseIncludedSet(r.includedSet);
      const drift = await checkEntityReportDrift(prisma, r);
      return {
        id: r.id,
        kind: r.kind,
        periodId: r.periodId,
        ridingNumber: r.ridingNumber,
        entityKind: r.entityKind,
        generatedAt: r.generatedAt,
        sentToCfoAt: r.sentToCfoAt,
        artifactId: r.artifactId,
        rowCount: stored.rows.length,
        dirty: drift.status === 'not-checked' ? null : drift.status === 'dirty',
      };
    }),
  );
}

export class EntityReportNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`entity report ${id} not found`);
    this.name = 'EntityReportNotFoundError';
  }
}

export async function getEntityReportDetail(prisma: PrismaClient, id: string) {
  const report = await prisma.entityReport.findUnique({ where: { id } });
  if (!report) throw new EntityReportNotFoundError(id);
  const drift = await checkEntityReportDrift(prisma, report);
  return { report, drift };
}

/** Screen 10's "send-to-CFO tracking" (CASL action `share`, already defined
 *  for the organizer role). No actual delivery happens — same gap tickets
 *  3.1/3.12 already left for receipt delivery — this just records that a
 *  human sent the file. */
export async function markEntityReportSentToCfo(
  prisma: PrismaClient,
  id: string,
  actorUserId: string,
  reason: string,
) {
  const existing = await prisma.entityReport.findUnique({ where: { id } });
  if (!existing) throw new EntityReportNotFoundError(id);

  return withChangeLog(prisma, { userId: actorUserId, reason }, async (ctx) => {
    const updated = await ctx.tx.entityReport.update({
      where: { id },
      data: { sentToCfoAt: new Date() },
    });
    await ctx.log({ subjectType: 'EntityReport', subjectId: id, before: existing, after: updated });
    return updated;
  });
}
