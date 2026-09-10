import { describe, expect, it } from 'vitest';
import { BigQueryWarehouseReader, type BigQueryLike } from './bigquery.js';
import { InMemoryWarehouse } from './fake.js';
import type { WarehouseReader } from './reader.js';
import type { WarehouseContribution } from './types.js';

function contribution(over: Partial<WarehouseContribution>): WarehouseContribution {
  return {
    warehouse_id: Math.random().toString(36).slice(2),
    qomon_transaction_id: 1,
    qomon_bundle_id: 1,
    legacy_ref: null,
    source_system: 'qomon',
    contact_ref: 'qomon:5',
    contact_name: 'Dana Donor',
    amount_cents: 10_000,
    currency: 'cad',
    accepted_at: '2026-03-01T12:00:00Z',
    payment_method: 'card',
    status: 'valid',
    code_campaign: null,
    reported_on: null,
    external_ref: null,
    updated_at: '2026-03-01T12:00:00Z',
    ...over,
  };
}

/** Contract both implementations must satisfy. */
function warehouseContract(label: string, make: () => Promise<WarehouseReader>) {
  describe(`warehouse contract: ${label}`, () => {
    it('streams every contribution across pages, in a stable order', async () => {
      const reader = await make();
      const all: string[] = [];
      for await (const row of reader.streamContributions()) all.push(row.warehouse_id);
      expect(new Set(all).size).toBe(all.length);
    });

    it('filters by updatedAfter for the incremental sweep', async () => {
      const reader = await make();
      const page = await reader.listContributions({
        updatedAfter: '2026-03-05T00:00:00Z',
      });
      expect(page.rows.every((r) => r.updated_at > '2026-03-05T00:00:00Z')).toBe(
        true,
      );
    });
  });
}

warehouseContract('in-memory fake', async () => {
  const w = new InMemoryWarehouse();
  w.seedContributions([
    contribution({ warehouse_id: 'a', updated_at: '2026-03-01T00:00:00Z' }),
    contribution({ warehouse_id: 'b', updated_at: '2026-03-10T00:00:00Z' }),
    contribution({ warehouse_id: 'c', updated_at: '2026-03-20T00:00:00Z' }),
  ]);
  return w;
});

warehouseContract('bigquery reader over a stub client', async () => {
  const store = [
    contribution({ warehouse_id: 'a', updated_at: '2026-03-01T00:00:00Z' }),
    contribution({ warehouse_id: 'b', updated_at: '2026-03-10T00:00:00Z' }),
    contribution({ warehouse_id: 'c', updated_at: '2026-03-20T00:00:00Z' }),
  ];
  const bq: BigQueryLike = {
    async query({ query, params }) {
      // extremely small SQL emulation: honour updated_at > @updatedAfter and LIMIT
      let rows = [...store].sort((x, y) => x.updated_at.localeCompare(y.updated_at));
      const after = params?.updatedAfter as string | undefined;
      if (after) rows = rows.filter((r) => r.updated_at > after);
      if (params?.cursorUpdatedAt) {
        const cu = params.cursorUpdatedAt as string;
        const ci = params.cursorId as string;
        rows = rows.filter(
          (r) =>
            r.updated_at > cu || (r.updated_at === cu && r.warehouse_id > ci),
        );
      }
      const limit = (params?.limit as number) ?? rows.length;
      void query;
      return [rows.slice(0, limit) as unknown as Array<Record<string, unknown>>];
    },
  };
  return new BigQueryWarehouseReader(bq, { projectId: 'p', pageSize: 2 });
});

describe('BigQueryWarehouseReader specifics', () => {
  it('keyset-paginates without dropping or repeating rows', async () => {
    const store = Array.from({ length: 7 }, (_, i) =>
      contribution({
        warehouse_id: `id${i}`,
        updated_at: `2026-03-0${i + 1}T00:00:00Z`,
      }),
    );
    const bq: BigQueryLike = {
      async query({ params }) {
        let rows = [...store].sort((a, b) =>
          a.updated_at === b.updated_at
            ? a.warehouse_id.localeCompare(b.warehouse_id)
            : a.updated_at.localeCompare(b.updated_at),
        );
        if (params?.cursorUpdatedAt) {
          const cu = params.cursorUpdatedAt as string;
          const ci = params.cursorId as string;
          rows = rows.filter(
            (r) => r.updated_at > cu || (r.updated_at === cu && r.warehouse_id > ci),
          );
        }
        const limit = (params?.limit as number) ?? rows.length;
        return [rows.slice(0, limit) as unknown as Array<Record<string, unknown>>];
      },
    };
    const reader = new BigQueryWarehouseReader(bq, { projectId: 'p', pageSize: 3 });
    const seen: string[] = [];
    for await (const r of reader.streamContributions()) seen.push(r.warehouse_id);
    expect(seen).toEqual(store.map((s) => s.warehouse_id));
  });

  it('rejects an identity-free history query', async () => {
    const reader = new BigQueryWarehouseReader(
      { async query() { return [[]]; } },
      { projectId: 'p' },
    );
    await expect(reader.getContributorHistory({})).rejects.toThrow(/identity/);
  });
});
