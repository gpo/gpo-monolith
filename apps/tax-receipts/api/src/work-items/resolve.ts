import { withChangeLog } from '../changelog/write.js';
import type { PrismaClient, WorkItem } from '../generated/prisma/index.js';

/**
 * Staff-driven resolution actions (ticket 1.7, validation-rules.md: "typed
 * (fix field, reallocate, refund, merge, exception)"). This is the generic
 * close/except primitive shared by any WorkItem kind — VALIDATION today,
 * DIFF/OWED_TO_EO/SYNC_INCIDENT once their tickets wire it up. Typed fix
 * actions (reallocate, refund, merge, ...) are separate, later work; this is
 * only the close itself.
 *
 * "Every close writes a ChangeLogEntry" (data-model §2 WorkItem) is honoured
 * even though WorkItem isn't one of invariant 5's DB-guarded tables.
 */

export class WorkItemNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(workItemId: string) {
    super(`no work item ${workItemId}`);
    this.name = 'WorkItemNotFoundError';
  }
}

export class WorkItemAlreadyClosedError extends Error {
  readonly statusCode = 409;
  constructor(workItemId: string, status: string) {
    super(`work item ${workItemId} is already ${status}`);
    this.name = 'WorkItemAlreadyClosedError';
  }
}

export type ResolutionOutcome = 'RESOLVED' | 'EXCEPTION';

export interface ResolveWorkItemInput {
  workItemId: string;
  actorUserId: string;
  /** mandatory (invariant 5's spirit, applied here by convention). */
  reason: string;
  outcome: ResolutionOutcome;
}

export async function resolveWorkItem(
  prisma: PrismaClient,
  input: ResolveWorkItemInput,
): Promise<WorkItem> {
  const current = await prisma.workItem.findUnique({ where: { id: input.workItemId } });
  if (!current) throw new WorkItemNotFoundError(input.workItemId);
  if (current.status !== 'OPEN') {
    throw new WorkItemAlreadyClosedError(input.workItemId, current.status);
  }

  return withChangeLog(prisma, { userId: input.actorUserId, reason: input.reason }, async (ctx) => {
    const before = current;
    const after = await ctx.tx.workItem.update({
      where: { id: current.id },
      data: {
        status: input.outcome,
        resolutionNote: input.reason,
        closedAt: new Date(),
      },
    });
    await ctx.log({ subjectType: 'WorkItem', subjectId: current.id, before, after });
    return after;
  });
}
