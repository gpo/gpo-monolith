import type {
  ContributorHistoryParams,
  ListContributionsParams,
  Page,
  WarehouseContact,
  WarehouseContribution,
} from './types.js';

/**
 * The read surface the tool depends on. `BigQueryWarehouseReader` (real) and
 * `InMemoryWarehouse` (fake) both implement it; the contract suite runs
 * against either.
 */
export interface WarehouseReader {
  readonly kind: string;

  /** One page of contributions for the bulk mirror seed (ticket 1.1). */
  listContributions(
    params?: ListContributionsParams,
  ): Promise<Page<WarehouseContribution>>;

  /** Stream every matching contribution, transparently following cursors. */
  streamContributions(
    params?: ListContributionsParams,
  ): AsyncGenerator<WarehouseContribution>;

  /** A contributor's full history across CiviCRM/GVote and Qomon, for the
   *  cross-year picture (limits, RTD aggregate reconstruction at import). */
  getContributorHistory(
    params: ContributorHistoryParams,
  ): Promise<WarehouseContribution[]>;

  listContacts(params?: {
    updatedAfter?: string;
    limit?: number;
    cursor?: string;
  }): Promise<Page<WarehouseContact>>;
}

/** Default streaming implementation on top of a paged `listContributions`. */
export async function* streamViaPages(
  list: (p: ListContributionsParams) => Promise<Page<WarehouseContribution>>,
  params: ListContributionsParams = {},
): AsyncGenerator<WarehouseContribution> {
  let cursor: string | null = params.cursor ?? null;
  for (;;) {
    const page: Page<WarehouseContribution> = await list({
      ...params,
      cursor: cursor ?? undefined,
    });
    for (const row of page.rows) yield row;
    if (!page.cursor || page.rows.length === 0) return;
    cursor = page.cursor;
  }
}
