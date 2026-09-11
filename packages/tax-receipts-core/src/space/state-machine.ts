import { SpaceStage } from '../enums.js';

/**
 * The W6 space ladder (data-model §2 SpaceState; workflows.md W6/W7): every
 * space (period, riding, entity kind) carries a materialized stage —
 * "intake complete, queue empty, reconciled, issued, delivered, reported,
 * sent to CFO" — that the process-owner dashboard (ticket 1.10) reads. The
 * space itself stays derived; only this tracking state is stored.
 *
 * This is deliberately just the ladder's shape and direction, not a gate:
 * the real preconditions for each move ("queue actually empty," "issuance
 * actually happened") belong to the tickets that trigger it (1.7's
 * validation queue, 3.x issuance/delivery, Phase 4 reporting). All this
 * package enforces is: a same-stage no-op is fine, any forward move is fine
 * (including skipping stages — a backfilled or pilot space may jump
 * straight to "reported"), and a backward move must be explicit.
 */

export const SPACE_STAGE_ORDER: readonly SpaceStage[] = [
  'intake',
  'queue-clear',
  'reconciled',
  'issued',
  'delivered',
  'reported',
  'sent-to-cfo',
];

export function stageIndex(stage: SpaceStage): number {
  const i = SPACE_STAGE_ORDER.indexOf(stage);
  if (i === -1) throw new Error(`unknown space stage "${stage}"`);
  return i;
}

export type SpaceTransitionKind = 'advance' | 'regress' | 'noop';

export function classifyTransition(from: SpaceStage, to: SpaceStage): SpaceTransitionKind {
  const delta = stageIndex(to) - stageIndex(from);
  if (delta === 0) return 'noop';
  return delta > 0 ? 'advance' : 'regress';
}

export class InvalidSpaceTransitionError extends Error {
  constructor(
    readonly from: SpaceStage,
    readonly to: SpaceStage,
    reason: string,
  ) {
    super(`cannot move a space from "${from}" to "${to}": ${reason}`);
    this.name = 'InvalidSpaceTransitionError';
  }
}

export interface AssertTransitionOptions {
  /** a regression (e.g. a correction or diff reopening an already-issued
   *  space) must set this explicitly; forward moves and no-ops never need
   *  it. */
  allowRegress?: boolean;
}

/** Throws {@link InvalidSpaceTransitionError} for an un-allowed regression;
 *  otherwise returns the transition's {@link SpaceTransitionKind}. */
export function assertValidTransition(
  from: SpaceStage,
  to: SpaceStage,
  options: AssertTransitionOptions = {},
): SpaceTransitionKind {
  const kind = classifyTransition(from, to);
  if (kind === 'regress' && !options.allowRegress) {
    throw new InvalidSpaceTransitionError(
      from,
      to,
      'regressions must be explicit (pass allowRegress) — a space does not silently move backward',
    );
  }
  return kind;
}
