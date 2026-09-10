import type { QomonMetadataEnvelope } from '@gpo/tax-receipts-core';
import type {
  QomonBundle,
  QomonCodeCampaign,
  QomonContact,
  QomonHistoryEntry,
  QomonTransactionSettings,
  QomonTransactionStatus,
} from './types.js';

export interface ListPage<T> {
  data: T[];
  total?: number;
}

export interface ListBundlesParams {
  /** default 100, hard cap 1000 (newest first). */
  limit?: number;
  offset?: number;
}

/** Additive bundle PATCH (qomon-api-reference §1.4): include an item `id` to
 *  modify it, omit `id` to add. Items cannot be removed. */
export interface BundlePatch {
  id: number;
  transactions?: Array<{ id?: number; [k: string]: unknown }>;
  donations?: Array<{ id?: number; [k: string]: unknown }>;
  memberships?: Array<{ id?: number; [k: string]: unknown }>;
}

export interface CreateBundleInput {
  transactions: Array<Record<string, unknown>>;
  donations?: Array<Record<string, unknown>>;
  memberships?: Array<Record<string, unknown>>;
}

/**
 * The contract the tool depends on. `QomonClient` (real REST) and
 * `InMemoryQomon` (contract-test fake) both implement it, and the contract
 * suite runs against either.
 */
export interface QomonApi {
  listTransactionBundles(params?: ListBundlesParams): Promise<ListPage<QomonBundle>>;
  getTransactionBundle(id: number): Promise<QomonBundle>;
  createTransactionBundle(input: CreateBundleInput): Promise<QomonBundle>;
  patchTransactionBundle(patch: BundlePatch): Promise<QomonBundle>;
  getTransactionBundleHistory(id: number): Promise<QomonHistoryEntry[]>;

  listTransactionStatuses(): Promise<QomonTransactionStatus[]>;
  listCodeCampaigns(): Promise<QomonCodeCampaign[]>;
  getTransactionSettings(): Promise<QomonTransactionSettings>;

  /** Whole-object metadata write onto one transaction in a bundle (D4: the
   *  tool always writes the entire object, never a partial merge). */
  writeTransactionMetadata(
    bundleId: number,
    transactionId: number,
    metadata: QomonMetadataEnvelope,
  ): Promise<QomonBundle>;

  /** Synchronous create; returns the new contact id in one round trip. */
  createContact(contact: QomonContact): Promise<{ id: number }>;
  /** Full-replace PATCH; every field must be supplied. */
  replaceContact(id: number, contact: QomonContact): Promise<QomonContact>;
  getContact(id: number): Promise<QomonContact>;
}
