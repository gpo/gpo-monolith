import { z } from 'zod';
import { streamViaPages, type WarehouseReader } from './reader.js';
import {
  WarehouseContact,
  WarehouseContribution,
  type ContributorHistoryParams,
  type ListContributionsParams,
  type Page,
} from './types.js';

/**
 * BigQuery-backed warehouse reader. Real wiring is deferred until the seed
 * lands (C1/C2); the table names below are the *documented default contract*
 * and are overridable via config so they can be pinned to whatever the
 * migration programme actually produces. See open-questions.md.
 */

export const BigQueryWarehouseConfig = z.object({
  projectId: z.string(),
  /** e.g. `northamerica-northeast2` (O27). */
  location: z.string().default('northamerica-northeast2'),
  dataset: z.string().default('gpo_warehouse'),
  tables: z
    .object({
      contributions: z.string().default('contributions'),
      contacts: z.string().default('contacts'),
    })
    .default({ contributions: 'contributions', contacts: 'contacts' }),
  /** page size for keyset pagination. */
  pageSize: z.number().int().positive().default(5000),
});
export type BigQueryWarehouseConfig = z.infer<typeof BigQueryWarehouseConfig>;

/** Minimal shape of the `@google-cloud/bigquery` client we use, so the dep can
 *  stay an optional peer and tests need not install it. */
export interface BigQueryLike {
  query(options: {
    query: string;
    params?: Record<string, unknown>;
    location?: string;
  }): Promise<[Array<Record<string, unknown>>]>;
}

export class BigQueryWarehouseReader implements WarehouseReader {
  readonly kind = 'bigquery';
  private readonly cfg: BigQueryWarehouseConfig;

  constructor(
    private readonly bq: BigQueryLike,
    config: z.input<typeof BigQueryWarehouseConfig>,
  ) {
    this.cfg = BigQueryWarehouseConfig.parse(config);
  }

  /** Construct a reader with a real BigQuery client (dynamically imported so
   *  the dependency stays optional). */
  static async connect(
    config: z.input<typeof BigQueryWarehouseConfig>,
  ): Promise<BigQueryWarehouseReader> {
    const parsed = BigQueryWarehouseConfig.parse(config);
    const mod = (await import('@google-cloud/bigquery')) as unknown as {
      BigQuery: new (opts: { projectId: string }) => BigQueryLike;
    };
    const client = new mod.BigQuery({ projectId: parsed.projectId });
    return new BigQueryWarehouseReader(client, parsed);
  }

  private table(name: 'contributions' | 'contacts'): string {
    return `\`${this.cfg.projectId}.${this.cfg.dataset}.${this.cfg.tables[name]}\``;
  }

  async listContributions(
    params: ListContributionsParams = {},
  ): Promise<Page<WarehouseContribution>> {
    const where: string[] = [];
    const bindings: Record<string, unknown> = {};
    if (params.updatedAfter) {
      where.push('updated_at > @updatedAfter');
      bindings.updatedAfter = params.updatedAfter;
    }
    if (params.acceptedFrom) {
      where.push('accepted_at >= @acceptedFrom');
      bindings.acceptedFrom = params.acceptedFrom;
    }
    if (params.acceptedTo) {
      where.push('accepted_at <= @acceptedTo');
      bindings.acceptedTo = params.acceptedTo;
    }
    if (params.sourceSystem) {
      where.push('source_system = @sourceSystem');
      bindings.sourceSystem = params.sourceSystem;
    }
    // keyset pagination on (updated_at, warehouse_id)
    if (params.cursor) {
      const { updatedAt, id } = decodeCursor(params.cursor);
      where.push(
        '(updated_at > @cursorUpdatedAt OR (updated_at = @cursorUpdatedAt AND warehouse_id > @cursorId))',
      );
      bindings.cursorUpdatedAt = updatedAt;
      bindings.cursorId = id;
    }
    const limit = params.limit ?? this.cfg.pageSize;
    bindings.limit = limit;

    const sql = `
      SELECT * FROM ${this.table('contributions')}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY updated_at, warehouse_id
      LIMIT @limit`;

    const [rows] = await this.bq.query({
      query: sql,
      params: bindings,
      location: this.cfg.location,
    });
    const parsed = rows.map((r) => WarehouseContribution.parse(coerceRow(r)));
    const last = parsed.at(-1);
    return {
      rows: parsed,
      cursor:
        parsed.length === limit && last
          ? encodeCursor(last.updated_at, last.warehouse_id)
          : null,
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
    const where: string[] = [];
    const bindings: Record<string, unknown> = {};
    if (params.qomonContactId != null) {
      where.push('qomon_contact_id = @qomonContactId');
      bindings.qomonContactId = params.qomonContactId;
    }
    if (params.email) {
      where.push('LOWER(email) = @email');
      bindings.email = params.email.toLowerCase();
    }
    if (params.name) {
      where.push('LOWER(firstname) = @firstname AND LOWER(surname) = @surname');
      bindings.firstname = params.name.firstname.toLowerCase();
      bindings.surname = params.name.surname.toLowerCase();
    }
    if (params.fromYear) {
      where.push('EXTRACT(YEAR FROM accepted_at) >= @fromYear');
      bindings.fromYear = params.fromYear;
    }
    if (where.length === 0) {
      throw new Error('getContributorHistory needs at least one identity filter');
    }
    const sql = `
      SELECT c.* FROM ${this.table('contributions')} c
      LEFT JOIN ${this.table('contacts')} k ON k.warehouse_id = c.contact_ref
      WHERE ${where.join(' AND ')}
      ORDER BY accepted_at`;
    const [rows] = await this.bq.query({
      query: sql,
      params: bindings,
      location: this.cfg.location,
    });
    return rows.map((r) => WarehouseContribution.parse(coerceRow(r)));
  }

  async listContacts(
    params: { updatedAfter?: string; limit?: number; cursor?: string } = {},
  ): Promise<Page<WarehouseContact>> {
    const where: string[] = [];
    const bindings: Record<string, unknown> = {};
    if (params.updatedAfter) {
      where.push('updated_at > @updatedAfter');
      bindings.updatedAfter = params.updatedAfter;
    }
    if (params.cursor) {
      where.push('warehouse_id > @cursorId');
      bindings.cursorId = params.cursor;
    }
    const limit = params.limit ?? this.cfg.pageSize;
    bindings.limit = limit;
    const sql = `
      SELECT * FROM ${this.table('contacts')}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY warehouse_id
      LIMIT @limit`;
    const [rows] = await this.bq.query({
      query: sql,
      params: bindings,
      location: this.cfg.location,
    });
    const parsed = rows.map((r) => WarehouseContact.parse(coerceRow(r)));
    return {
      rows: parsed,
      cursor:
        parsed.length === limit ? (parsed.at(-1)?.warehouse_id ?? null) : null,
    };
  }
}

function coerceRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    // BigQuery returns timestamps as { value: string } wrappers
    if (v && typeof v === 'object' && 'value' in v) {
      out[k] = (v as { value: unknown }).value;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function encodeCursor(updatedAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ updatedAt, id })).toString('base64url');
}
function decodeCursor(cursor: string): { updatedAt: string; id: string } {
  return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
}
