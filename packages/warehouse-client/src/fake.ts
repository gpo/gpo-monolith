import {
  streamViaPages,
  type WarehouseReader,
} from './reader.js';
import type {
  ContributorHistoryParams,
  ListContributionsParams,
  Page,
  WarehouseContact,
  WarehouseContribution,
} from './types.js';

/**
 * In-memory warehouse fake. Stands in for BigQuery until the seed lands
 * (C1/C2). Applies the same filters the real reader documents so the mirror
 * sweep (1.1) can be built and tested now.
 */
export class InMemoryWarehouse implements WarehouseReader {
  readonly kind = 'in-memory';
  private contributions: WarehouseContribution[] = [];
  private contacts: WarehouseContact[] = [];

  seedContributions(rows: WarehouseContribution[]): this {
    this.contributions.push(...rows);
    return this;
  }
  seedContacts(rows: WarehouseContact[]): this {
    this.contacts.push(...rows);
    return this;
  }

  private filtered(params: ListContributionsParams): WarehouseContribution[] {
    return this.contributions
      .filter((r) => {
        if (params.updatedAfter && !(r.updated_at > params.updatedAfter)) return false;
        if (params.acceptedFrom && r.accepted_at < params.acceptedFrom) return false;
        if (params.acceptedTo && r.accepted_at > params.acceptedTo) return false;
        if (params.sourceSystem && r.source_system !== params.sourceSystem) return false;
        return true;
      })
      .sort((a, b) =>
        a.updated_at === b.updated_at
          ? a.warehouse_id.localeCompare(b.warehouse_id)
          : a.updated_at.localeCompare(b.updated_at),
      );
  }

  async listContributions(
    params: ListContributionsParams = {},
  ): Promise<Page<WarehouseContribution>> {
    const rows = this.filtered(params);
    const limit = params.limit ?? 1000;
    const start = params.cursor ? Number(params.cursor) : 0;
    const slice = rows.slice(start, start + limit);
    const next = start + slice.length;
    return {
      rows: slice,
      cursor: next < rows.length ? String(next) : null,
    };
  }

  streamContributions(
    params: ListContributionsParams = {},
  ): AsyncGenerator<WarehouseContribution> {
    return streamViaPages((p) => this.listContributions(p), params);
  }

  async getContributorHistory(
    params: ContributorHistoryParams,
  ): Promise<WarehouseContribution[]> {
    return this.contributions.filter((r) => {
      if (params.qomonContactId != null) {
        if (r.contact_ref === `qomon:${params.qomonContactId}`) return true;
      }
      if (params.email && r.contact_name && params.email) {
        // fake identity match: contact_ref carries an email for legacy rows
        if (r.contact_ref === `email:${params.email.toLowerCase()}`) return true;
      }
      if (params.name && r.contact_name) {
        const want = `${params.name.firstname} ${params.name.surname}`.toLowerCase();
        if (r.contact_name.toLowerCase() === want) return true;
      }
      return false;
    });
  }

  async listContacts(
    params: { updatedAfter?: string; limit?: number; cursor?: string } = {},
  ): Promise<Page<WarehouseContact>> {
    const rows = this.contacts
      .filter((c) => !params.updatedAfter || c.updated_at > params.updatedAfter)
      .sort((a, b) => a.warehouse_id.localeCompare(b.warehouse_id));
    const limit = params.limit ?? 1000;
    const start = params.cursor ? Number(params.cursor) : 0;
    const slice = rows.slice(start, start + limit);
    const next = start + slice.length;
    return { rows: slice, cursor: next < rows.length ? String(next) : null };
  }
}
