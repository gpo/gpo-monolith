import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * Drift-detection hash over a Qomon transaction's mirrored fact fields
 * (data-model §2 Contribution `sync_hash`, §5 sweep decision node "sync_hash
 * or metadata checksum changed?"). Deliberately separate from
 * {@link import('./metadata.js').computeMetadataChecksum}, which covers only
 * the descriptive metadata object: this hash covers the transaction facts
 * Qomon owns directly (amount, date, contact, payment method, status,
 * campaign code, comment, external id), so an edit to either can be detected
 * independently.
 */

export const ContributionSyncFields = z.object({
  amountCents: z.number().int(),
  currency: z.string(),
  /** acceptance date, ISO instant */
  acceptedAt: z.string(),
  qomonContactId: z.string(), // bigint carried as string for stable JSON
  paymentMethodKind: z.string().nullable(),
  statusKind: z.string(),
  codeCampaign: z.string().nullable(),
  comment: z.string().nullable(),
  externalTransactionId: z.string().nullable(),
});
export type ContributionSyncFields = z.infer<typeof ContributionSyncFields>;

const SYNC_KEYS: (keyof ContributionSyncFields)[] = [
  'amountCents',
  'currency',
  'acceptedAt',
  'qomonContactId',
  'paymentMethodKind',
  'statusKind',
  'codeCampaign',
  'comment',
  'externalTransactionId',
];

/** Order is fixed so the hash is stable regardless of source key order. */
export function canonicalSyncJson(f: ContributionSyncFields): string {
  const ordered: Record<string, unknown> = {};
  for (const k of SYNC_KEYS) ordered[k] = f[k];
  return JSON.stringify(ordered);
}

export function computeContributionSyncHash(f: ContributionSyncFields): string {
  const hash = createHash('sha256').update(canonicalSyncJson(f)).digest('hex');
  return `sha256:${hash}`;
}
