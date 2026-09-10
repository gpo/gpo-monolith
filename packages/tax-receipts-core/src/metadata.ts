import { createHash } from 'node:crypto';
import { z } from 'zod';
import { EntityKind, ReceivedBy } from './enums.js';

/**
 * The Qomon transaction `metadata` JSON object (data-model §3). Qomon is the
 * source of truth for this object (D4); the tool caches it and writes the
 * WHOLE object on every edit (no partial merges).
 *
 * `v` gates schema evolution: unknown versions are read-only to the tool.
 */

/** Descriptive fields only: the subset the `checksum` covers and the sweep
 *  compares to detect edits made by other writers (data-model §3, §5). */
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

/** Denormalized echoes for staff reading inside Qomon. The tool NEVER reads
 *  these back as truth (data-model §3). */
export const GpoMetadataEchoes = z.object({
  rtd: z
    .object({ filing: z.string(), reported_at: z.string() })
    .nullable()
    .optional(),
  receipts: z
    .array(
      z.object({
        no: z.string(),
        status: z.string(),
        amount_cents: z.number().int(),
      }),
    )
    .optional(),
  synced_at: z.string().datetime().optional(),
  checksum: z.string().optional(),
});
export type GpoMetadataEchoes = z.infer<typeof GpoMetadataEchoes>;

export const GpoMetadata = GpoMetadataDescriptive.merge(GpoMetadataEchoes);
export type GpoMetadata = z.infer<typeof GpoMetadata>;

export const QomonMetadataEnvelope = z.object({
  v: z.literal(1),
  gpo: GpoMetadata,
});
export type QomonMetadataEnvelope = z.infer<typeof QomonMetadataEnvelope>;

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

export interface BuildMetadataInput {
  descriptive: GpoMetadataDescriptive;
  echoes?: Omit<GpoMetadataEchoes, 'checksum'>;
  syncedAt?: Date;
}

/** Produce the whole `{ v, gpo }` object to PATCH onto a Qomon bundle. */
export function buildMetadataEnvelope(
  input: BuildMetadataInput,
): QomonMetadataEnvelope {
  const checksum = computeMetadataChecksum(input.descriptive);
  return {
    v: 1,
    gpo: {
      ...input.descriptive,
      ...input.echoes,
      synced_at: (input.syncedAt ?? new Date()).toISOString(),
      checksum,
    },
  };
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
