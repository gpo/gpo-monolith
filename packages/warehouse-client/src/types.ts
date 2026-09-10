import { z } from 'zod';

/**
 * The warehouse read contract (DESIGN §5, data-model §4-5).
 *
 * The BigQuery warehouse is the tool's bulk read layer: Qomon data lands
 * nightly, and CiviCRM/GVote history is archived there permanently with stable
 * join ids (assumption A2). The tool reads it for two things only:
 *  1. bulk contribution lists (the mirror seed, ticket 1.1)
 *  2. per-contributor history (across the CiviCRM era and Qomon)
 *
 * Correctness-critical reads never come from here: issuance, RTD export and
 * report generation re-fetch live from Qomon by id. The warehouse is allowed
 * to lag.
 *
 * NOT YET POPULATED (blocked on C1/C2). The exact dataset and column names are
 * a migration-programme deliverable; this module is written against the
 * documented shape below and a local fake, with real wiring deferred. The
 * table names are configurable so the contract can be pinned once C1 lands.
 */

/** One contribution row as the warehouse exposes it (union of the Qomon
 *  mirror and imported CiviCRM history). Money is integer cents. */
export const WarehouseContribution = z.object({
  /** Stable warehouse row id. */
  warehouse_id: z.string(),
  /** Qomon transaction id when the row originated in Qomon; null for
   *  CiviCRM-era rows that predate Qomon. */
  qomon_transaction_id: z.number().int().nullable(),
  qomon_bundle_id: z.number().int().nullable(),
  /** Legacy identifier (e.g. CiviCRM contribution id / cdntaxreceipts row). */
  legacy_ref: z.string().nullable(),
  source_system: z.enum(['qomon', 'civicrm', 'gvote', 'other']),
  contact_ref: z.string(),
  contact_name: z.string().nullable(),
  amount_cents: z.number().int(),
  currency: z.string().default('cad'),
  /** Acceptance date (drives everything EO). ISO date or datetime. */
  accepted_at: z.string(),
  payment_method: z.string().nullable(),
  status: z.string().nullable(),
  code_campaign: z.string().nullable(),
  /** Historical RTD marker (`reported_on_19`) when present. */
  reported_on: z.string().nullable(),
  external_ref: z.string().nullable(),
  updated_at: z.string(),
});
export type WarehouseContribution = z.infer<typeof WarehouseContribution>;

export const WarehouseContact = z.object({
  warehouse_id: z.string(),
  qomon_contact_id: z.number().int().nullable(),
  legacy_ref: z.string().nullable(),
  firstname: z.string().nullable(),
  surname: z.string().nullable(),
  email: z.string().nullable(),
  address_line: z.string().nullable(),
  city: z.string().nullable(),
  province: z.string().nullable(),
  postal_code: z.string().nullable(),
  updated_at: z.string(),
});
export type WarehouseContact = z.infer<typeof WarehouseContact>;

export interface ListContributionsParams {
  /** ISO instant; only rows updated strictly after this. */
  updatedAfter?: string;
  /** ISO date; acceptance date lower bound (inclusive). */
  acceptedFrom?: string;
  acceptedTo?: string;
  sourceSystem?: WarehouseContribution['source_system'];
  limit?: number;
  /** opaque continuation token from a previous page. */
  cursor?: string;
}

export interface ContributorHistoryParams {
  qomonContactId?: number;
  /** Fallback fuzzy identity for pre-Qomon rows. */
  name?: { firstname: string; surname: string };
  email?: string;
  /** calendar-year lower bound (inclusive). */
  fromYear?: number;
}

export interface Page<T> {
  rows: T[];
  cursor: string | null;
}
