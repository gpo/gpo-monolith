import { AmbiguousPeriodError, resolvePeriod, type PeriodRow } from '../period/calendar.js';
import type { GpoMetadataDescriptive } from '../metadata.js';

/**
 * Intake derivation defaults, applied when the mirror sweep (ticket 1.1)
 * first sees a Qomon transaction (data-model §6).
 *
 * THIS IS A STUB. The full rule set (riding from the originating subspace,
 * entity_kind from a "directed-to" field or `code_campaign`, received_by
 * from provenance, source-code parsing) is ticket 1.6 and is additionally
 * blocked on open items B3 (subspace `group_id` -> riding) and B8 (the
 * "directed-to" field or convention) — see STATUS.md. Until 1.6 lands, every
 * new contribution gets the documented fallback (data-model §6 / the
 * kickoff's blocker notes): riding_number null, entity_kind PARTY,
 * received_by GPO, all flagged for review. The one rule this stub CAN apply
 * correctly today is period_id, because the period calendar (ticket 0.6) has
 * no B3/B8-style blocker.
 *
 * Ticket 1.6 replaces the body of {@link deriveIntakeDefaults}; callers
 * (the mirror sweep) do not need to change.
 */

export interface IntakeDefaultsInput {
  /** acceptance date (drives period resolution; data-model §2 Contribution.date) */
  acceptedAt: Date;
  /** directed-to riding, when already known (by-election period scoping). Always
   *  null for this stub since riding derivation is ticket 1.6. */
  ridingNumber?: number | null;
  codeCampaign: string | null;
  externalRef: string | null;
  periods: readonly PeriodRow[];
}

export interface IntakeDefaultsResult {
  /** null when no period could be resolved; the caller mirrors the
   *  contribution without metadata and flags it (data-model §6: "never from
   *  a Qomon default"). */
  periodId: number | null;
  /** null exactly when periodId is null. */
  descriptive: GpoMetadataDescriptive | null;
  /** always true for this stub: every field besides period_id is a fallback
   *  pending ticket 1.6. */
  flagged: boolean;
  flagReason: string;
}

export function deriveIntakeDefaults(
  input: IntakeDefaultsInput,
): IntakeDefaultsResult {
  let period: PeriodRow | null;
  try {
    period = resolvePeriod(input.acceptedAt, input.periods, {
      ridingNumber: input.ridingNumber ?? null,
    });
  } catch (err) {
    if (err instanceof AmbiguousPeriodError) {
      return {
        periodId: null,
        descriptive: null,
        flagged: true,
        flagReason: `ambiguous period for acceptance date: ${err.message}`,
      };
    }
    throw err;
  }

  if (!period) {
    return {
      periodId: null,
      descriptive: null,
      flagged: true,
      flagReason: 'no configured period covers this contribution\'s acceptance date',
    };
  }

  const descriptive: GpoMetadataDescriptive = {
    period_id: period.id,
    riding_number: null,
    entity_kind: 'PARTY',
    received_by: 'GPO',
    goods_services: false,
    non_deductible_cents: 0,
    processed_date: null,
    source_code: input.codeCampaign ?? '',
    eo_contributor_id: null,
    exception_reason: null,
    external_ref: input.externalRef,
  };

  return {
    periodId: period.id,
    descriptive,
    flagged: true,
    flagReason:
      'riding_number, entity_kind, and received_by are stub defaults pending ticket 1.6 (B3/B8)',
  };
}
