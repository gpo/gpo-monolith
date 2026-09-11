import type {
  PrismaClient,
  WorkItemKind,
  WorkItemStatus,
} from '../generated/prisma/index.js';

/**
 * Work queue list (ticket 1.8, screens.md 5): the unified WorkItem screen's
 * four tabs (validation, diff, owed-to-EO, sync incidents) all read from
 * this one query, filtered by `kind`. Donor name comes from WorkItem's own
 * denormalized `contactId` (data-model §2: "the donor, denormalized for
 * queue views") rather than joining through `subjectId`, since `subjectId`
 * is a loose string shared by four different subject types.
 */

export interface WorkItemListFilters {
  kind?: WorkItemKind;
  status?: WorkItemStatus;
  ruleRef?: string;
  assigneeUserId?: string;
}

export interface WorkItemRow {
  id: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  contactId: string | null;
  contactName: string | null;
  ruleRef: string | null;
  dueAt: string | null;
  status: string;
  assigneeUserId: string | null;
  resolutionNote: string | null;
  openedAt: string;
  closedAt: string | null;
}

export interface WorkItemListPage {
  data: WorkItemRow[];
  nextCursor: string | null;
}

export async function listWorkItems(
  prisma: PrismaClient,
  opts: { filters: WorkItemListFilters; limit?: number; cursor?: string | null },
): Promise<WorkItemListPage> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 100));
  const { filters } = opts;

  const rows = await prisma.workItem.findMany({
    where: {
      kind: filters.kind,
      status: filters.status,
      ruleRef: filters.ruleRef,
      assigneeUserId: filters.assigneeUserId,
    },
    include: { contact: true },
    orderBy: [{ ruleRef: 'asc' }, { openedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const data: WorkItemRow[] = page.map((w) => ({
    id: w.id,
    kind: w.kind,
    subjectType: w.subjectType,
    subjectId: w.subjectId,
    contactId: w.contactId,
    contactName: w.contact?.name ?? null,
    ruleRef: w.ruleRef,
    dueAt: w.dueAt ? w.dueAt.toISOString() : null,
    status: w.status,
    assigneeUserId: w.assigneeUserId,
    resolutionNote: w.resolutionNote,
    openedAt: w.openedAt.toISOString(),
    closedAt: w.closedAt ? w.closedAt.toISOString() : null,
  }));

  return { data, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null };
}
