import { AmbiguousPeriodError, resolvePeriod, type PeriodRow } from '../period/calendar.js';
import type { GpoMetadataDescriptive } from '../metadata.js';
import { parseRidingFromSourceCode } from '../source-code.js';
import type { EntityKind, ReceivedBy } from '../enums.js';

/**
 * Intake derivation defaults (ticket 1.6, data-model §6): applied when the
 * mirror sweep (ticket 1.1) first sees a Qomon transaction.
 *
 * Three of the four rules are partially or fully blocked as of 2026-09-11
 * (STATUS.md B3, B8) — per the Phase 1 kickoff prompt's ground rule ("do not
 * guess and do not invent behavior"), each blocked field falls back to the
 * documented default and is flagged rather than guessed:
 *
 *  - **period_id**: fully derivable (period calendar, ticket 0.6; no
 *    blocker). Uses the derived riding (below) to scope by-election periods.
 *  - **riding_number**: subspace-based derivation is blocked (B3: no
 *    confirmed `group_id` -> riding convention). Source-code parsing (rule
 *    A7) is NOT blocked, so a directed online source code (`TSF.W.007`)
 *    still resolves a riding; only an undirected code (subspace CFO entry,
 *    or a general/party code) falls back to null, flagged.
 *  - **entity_kind**: no unblocked source exists at all (B8: no
 *    "directed-to" field or `code_campaign` convention yet), and D6 forbids
 *    deriving it from the space regardless. Always PARTY, flagged.
 *  - **received_by**: invariant 8's "a processor record forces GPO" clause
 *    is unblocked (a processor `external_ref` is a reliable signal) and is
 *    applied with confidence. Distinguishing "CFO subspace entry" (defaults
 *    ENTITY) from "central manual entry" (defaults GPO) needs the same
 *    space identification B3 blocks, so anything else defaults GPO,
 *    flagged, per invariant 8's own fallback ("with operator override").
 */

export interface IntakeFlag {
  field: 'period_id' | 'riding_number' | 'entity_kind' | 'received_by';
  reason: string;
}

export interface IntakeDefaultsInput {
  /** acceptance date (drives period resolution; data-model §2 Contribution.date) */
  acceptedAt: Date;
  /** already-known riding (e.g. once B3 resolves and a caller can identify
   *  the originating subspace) — takes priority over source-code parsing.
   *  No current caller passes this; the hook exists so B3 landing doesn't
   *  require another signature change here. */
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
  /** one entry per field this call could not derive with confidence. */
  flags: IntakeFlag[];
}

export function deriveIntakeDefaults(input: IntakeDefaultsInput): IntakeDefaultsResult {
  const flags: IntakeFlag[] = [];

  const ridingFromSourceCode = parseRidingFromSourceCode(input.codeCampaign);
  let ridingNumber: number | null;
  if (input.ridingNumber != null) {
    ridingNumber = input.ridingNumber;
  } else if (ridingFromSourceCode != null) {
    ridingNumber = ridingFromSourceCode;
  } else {
    ridingNumber = null;
    flags.push({
      field: 'riding_number',
      reason:
        'not derivable: the source code has no directed riding segment (rule A7), and subspace-based derivation is blocked pending B3',
    });
  }

  const entityKind: EntityKind = 'PARTY';
  flags.push({
    field: 'entity_kind',
    reason:
      'never derived from the space (D6); no "directed-to" field or code_campaign convention exists yet (B8) — defaulting PARTY',
  });

  const isProcessorRecord = input.externalRef != null && input.externalRef.trim().length > 0;
  const receivedBy: ReceivedBy = 'GPO';
  if (!isProcessorRecord) {
    flags.push({
      field: 'received_by',
      reason:
        'no processor external_ref present; cannot yet distinguish a CFO subspace entry (ENTITY) from central manual entry (GPO) pending B3 — defaulting GPO with operator override (invariant 8)',
    });
  }

  let period: PeriodRow | null;
  try {
    period = resolvePeriod(input.acceptedAt, input.periods, { ridingNumber });
  } catch (err) {
    if (err instanceof AmbiguousPeriodError) {
      return {
        periodId: null,
        descriptive: null,
        flags: [...flags, { field: 'period_id', reason: `ambiguous period: ${err.message}` }],
      };
    }
    throw err;
  }

  if (!period) {
    return {
      periodId: null,
      descriptive: null,
      flags: [
        ...flags,
        {
          field: 'period_id',
          reason: "no configured period covers this contribution's acceptance date",
        },
      ],
    };
  }

  const descriptive: GpoMetadataDescriptive = {
    period_id: period.id,
    riding_number: ridingNumber,
    entity_kind: entityKind,
    received_by: receivedBy,
    goods_services: false,
    non_deductible_cents: 0,
    processed_date: null,
    source_code: input.codeCampaign ?? '',
    eo_contributor_id: null,
    exception_reason: null,
    external_ref: input.externalRef,
  };

  return { periodId: period.id, descriptive, flags };
}
