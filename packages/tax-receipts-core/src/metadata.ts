import { createHash } from 'node:crypto';
import { z } from 'zod';
import { EntityKind, ReceivedBy } from './enums.js';

/**
 * The tool's own descriptive fields for a contribution (data-model §3).
 * Six of these round-trip through Qomon's `extra_json` custom fields on the
 * transaction (see @gpo/qomon-client's transaction-extra-fields.ts for the
 * mapping and which six); the rest — `received_by`, `eo_contributor_id`,
 * `exception_reason`, `non_deductible_cents`, `external_ref` — have no Qomon
 * counterpart and are tool-local only, cached here regardless so the whole
 * object stays the unit of local storage, editing, and checksumming.
 */

export const GpoMetadataDescriptive = z.object({
  period_id: z.number().int(),
  riding_number: z.number().int().min(1).max(124).nullable(),
  entity_kind: EntityKind,
  received_by: ReceivedBy,
  goods_services: z.boolean(),
  non_deductible_cents: z.number().int().min(0),
  processed_date: z.string().date().nullable(),
  source_code: z.string(),
  eo_contributor_id: z.string().nullable(),
  exception_reason: z.string().nullable(),
  external_ref: z.string().nullable(),
});
export type GpoMetadataDescriptive = z.infer<typeof GpoMetadataDescriptive>;

/** Order is fixed so the checksum is stable regardless of key order in the
 *  source object. */
const DESCRIPTIVE_KEYS: (keyof GpoMetadataDescriptive)[] = [
  'period_id',
  'riding_number',
  'entity_kind',
  'received_by',
  'goods_services',
  'non_deductible_cents',
  'processed_date',
  'source_code',
  'eo_contributor_id',
  'exception_reason',
  'external_ref',
];

export function canonicalDescriptiveJson(
  m: GpoMetadataDescriptive,
): string {
  const ordered: Record<string, unknown> = {};
  for (const k of DESCRIPTIVE_KEYS) ordered[k] = m[k];
  return JSON.stringify(ordered);
}

export function computeMetadataChecksum(m: GpoMetadataDescriptive): string {
  const hash = createHash('sha256')
    .update(canonicalDescriptiveJson(m))
    .digest('hex');
  return `sha256:${hash}`;
}

/** True when the descriptive content of a freshly fetched object differs from
 *  what the tool last cached (i.e. someone else edited it). */
export function descriptiveChanged(
  cachedChecksum: string | null | undefined,
  fetched: GpoMetadataDescriptive,
): boolean {
  if (!cachedChecksum) return true;
  return cachedChecksum !== computeMetadataChecksum(fetched);
}
