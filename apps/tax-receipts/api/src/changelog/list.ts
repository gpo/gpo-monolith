import type { ChangeLogSubjectType, PrismaClient } from '../generated/prisma/index.js';

/**
 * Change-log explorer (ticket 1.11, screens.md 12): the audit surface
 * underpinning guarantee G4 ("every mutation is evidenced"). Filter by
 * subject, actor, correlation id, and date; every entry carries its
 * before/after and reason already (invariant 5). Part of the EO
 * virtual-evaluation demo script (test-plan §6, Evaluation Tool rows 13-19)
 * — this is why 1.11 is on the critical path.
 *
 * No riding scoping here, unlike the contributions list/detail (1.3, 1.5):
 * this is the completeness-first audit trail for central staff (process
 * owner, auditors), and `ChangeLogEntry` doesn't carry a riding field of
 * its own to scope by (it would mean reaching into each entry's `before`/
 * `after` JSON, which is fragile and subject-type-dependent).
 */

export interface ChangeLogFilters {
  subjectType?: ChangeLogSubjectType;
  subjectId?: string;
  actorUserId?: string;
  correlationId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface ChangeLogRow {
  id: string;
  subjectType: string;
  subjectId: string;
  actorUserId: string | null;
  actorName: string | null;
  reason: string;
  before: unknown;
  after: unknown;
  at: string;
  correlationId: string;
}

export interface ChangeLogPage {
  data: ChangeLogRow[];
  nextCursor: string | null;
}

function whereFromFilters(filters: ChangeLogFilters) {
  return {
    subjectType: filters.subjectType,
    subjectId: filters.subjectId,
    actorUserId: filters.actorUserId,
    correlationId: filters.correlationId,
    at:
      filters.dateFrom || filters.dateTo
        ? {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          }
        : undefined,
  };
}

function toRow(e: {
  id: string;
  subjectType: string;
  subjectId: string;
  actorUserId: string | null;
  actor: { name: string } | null;
  reason: string;
  before: unknown;
  after: unknown;
  at: Date;
  correlationId: string;
}): ChangeLogRow {
  return {
    id: e.id,
    subjectType: e.subjectType,
    subjectId: e.subjectId,
    actorUserId: e.actorUserId,
    actorName: e.actor?.name ?? null,
    reason: e.reason,
    before: e.before,
    after: e.after,
    at: e.at.toISOString(),
    correlationId: e.correlationId,
  };
}

export async function listChangeLog(
  prisma: PrismaClient,
  opts: { filters: ChangeLogFilters; limit?: number; cursor?: string | null },
): Promise<ChangeLogPage> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 100));
  const rows = await prisma.changeLogEntry.findMany({
    where: whereFromFilters(opts.filters),
    include: { actor: true },
    orderBy: [{ at: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    data: page.map(toRow),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/** Hard cap on one export: keeps a single request's memory/response size
 *  bounded. No format is specified by any doc ("exportable for EO" is all
 *  screens.md says), so this is a judgment call: one row per entry, JSON
 *  columns serialized inline, RFC 4180 quoting. */
export const CHANGE_LOG_EXPORT_MAX_ROWS = 50_000;

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  return `"${s.replace(/"/g, '""')}"`;
}

export async function exportChangeLogCsv(
  prisma: PrismaClient,
  filters: ChangeLogFilters,
): Promise<string> {
  const rows = await prisma.changeLogEntry.findMany({
    where: whereFromFilters(filters),
    include: { actor: true },
    orderBy: [{ at: 'desc' }, { id: 'desc' }],
    take: CHANGE_LOG_EXPORT_MAX_ROWS,
  });

  const header = ['at', 'subjectType', 'subjectId', 'actor', 'reason', 'correlationId', 'before', 'after'];
  const lines = [header.map(csvCell).join(',')];
  for (const e of rows.map(toRow)) {
    lines.push(
      [e.at, e.subjectType, e.subjectId, e.actorName ?? 'system', e.reason, e.correlationId, e.before, e.after]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\r\n');
}
