import type { PrismaClient } from '../generated/prisma/index.js';

/**
 * Space dashboard (ticket 1.10, screens.md 1, PRD I3): "a grid of derived
 * spaces" — DESIGN.md §4: "spaces are derived, not stored". This computes
 * the grid from what actually has data (`ContributionMetadata`, grouped by
 * period/riding/entity kind) rather than from `SpaceState` rows, since a
 * space exists the moment a contribution is metadata-tagged into it, not
 * only once someone has explicitly moved its ladder stage. `SpaceState` is
 * left-joined on for stage/owner; a space with no `SpaceState` row yet
 * reads as stage "intake" (the ladder's start, ticket 1.9).
 *
 * The RTD clock's "nearest deadline" column (screens.md 1) is NOT included
 * here: nothing in the build yet computes an RTD due date per space (that's
 * Phase 2, the business-day clock wired to actual filings). Flagging rather
 * than faking a null placeholder that would look like "computed, none due."
 */

export interface SpaceDashboardRow {
  periodId: number;
  ridingNumber: number | null;
  entityKind: string;
  stage: string;
  stageOwner: string | null;
  contributionCount: number;
  openWorkItemCount: number;
}

function spaceKey(periodId: number, ridingNumber: number | null, entityKind: string): string {
  return `${periodId}:${ridingNumber ?? 'party'}:${entityKind}`;
}

export async function getSpaceDashboard(
  prisma: PrismaClient,
  ridingScope: readonly number[] | null,
): Promise<SpaceDashboardRow[]> {
  const grouped = await prisma.contributionMetadata.groupBy({
    by: ['periodId', 'ridingNumber', 'entityKind'],
    _count: { _all: true },
  });

  const inScope = grouped.filter(
    (g) => ridingScope === null || g.ridingNumber === null || ridingScope.includes(g.ridingNumber),
  );

  const states = await prisma.spaceState.findMany();
  const stateByKey = new Map(
    states.map((s) => [spaceKey(s.periodId, s.ridingNumber, s.entityKind), s]),
  );

  const openItems = await prisma.workItem.findMany({
    where: { status: 'OPEN', subjectType: 'Contribution' },
    select: { subjectId: true },
  });
  const openContributionIds = [...new Set(openItems.map((i) => i.subjectId))];
  const metaForOpenItems =
    openContributionIds.length > 0
      ? await prisma.contributionMetadata.findMany({
          where: { contributionId: { in: openContributionIds } },
          select: { contributionId: true, periodId: true, ridingNumber: true, entityKind: true },
        })
      : [];
  const metaByContribution = new Map(metaForOpenItems.map((m) => [m.contributionId, m]));
  const openCountByKey = new Map<string, number>();
  for (const item of openItems) {
    const meta = metaByContribution.get(item.subjectId);
    if (!meta) continue;
    const k = spaceKey(meta.periodId, meta.ridingNumber, meta.entityKind);
    openCountByKey.set(k, (openCountByKey.get(k) ?? 0) + 1);
  }

  return inScope
    .map((g) => {
      const k = spaceKey(g.periodId, g.ridingNumber, g.entityKind);
      const state = stateByKey.get(k);
      return {
        periodId: g.periodId,
        ridingNumber: g.ridingNumber,
        entityKind: g.entityKind,
        stage: state ? state.stage.replace(/_/g, '-') : 'intake',
        stageOwner: state?.stageOwner ?? null,
        contributionCount: g._count._all,
        openWorkItemCount: openCountByKey.get(k) ?? 0,
      };
    })
    .sort((a, b) => a.periodId - b.periodId || (a.ridingNumber ?? 0) - (b.ridingNumber ?? 0));
}
