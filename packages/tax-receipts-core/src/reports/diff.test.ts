import { describe, expect, it } from 'vitest';
import { diffReportRows } from './diff.js';

interface Row extends Record<string, string | number> {
  Receipt_Number: string;
  Contribution_Amount: string;
  Receipt_Status: string;
}

const keyOf = (row: Row) => row.Receipt_Number;

function row(overrides: Partial<Row> = {}): Row {
  return {
    Receipt_Number: 'GPO-00000001',
    Contribution_Amount: '100.00',
    Receipt_Status: 'I',
    ...overrides,
  };
}

describe('diffReportRows', () => {
  it('reports no changes for identical row sets', () => {
    const rows = [row()];
    const result = diffReportRows(rows, rows, keyOf);
    expect(result).toEqual({ changed: [], added: [], removed: [] });
  });

  it('detects a changed field on a row present in both sets (the E5 case)', () => {
    const before = [row({ Receipt_Status: 'I' })];
    const after = [row({ Receipt_Status: 'C' })];
    const result = diffReportRows(before, after, keyOf);
    expect(result.changed).toHaveLength(1);
    expect(result.changed[0]).toMatchObject({
      key: 'GPO-00000001',
      fields: [{ field: 'Receipt_Status', before: 'I', after: 'C' }],
    });
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it('reports every changed field, not just the first', () => {
    const before = [row({ Receipt_Status: 'I', Contribution_Amount: '100.00' })];
    const after = [row({ Receipt_Status: 'C', Contribution_Amount: '50.00' })];
    const result = diffReportRows(before, after, keyOf);
    expect(result.changed[0]!.fields.map((f) => f.field).sort()).toEqual([
      'Contribution_Amount',
      'Receipt_Status',
    ]);
  });

  it('reports a row present only in "after" as added, not changed', () => {
    const before: Row[] = [];
    const after = [row()];
    const result = diffReportRows(before, after, keyOf);
    expect(result.added).toEqual([row()]);
    expect(result.changed).toEqual([]);
  });

  it('reports a row present only in "before" as removed', () => {
    const before = [row()];
    const after: Row[] = [];
    const result = diffReportRows(before, after, keyOf);
    expect(result.removed).toEqual([row()]);
    expect(result.changed).toEqual([]);
  });

  it('handles a mix of changed, added, and removed rows together', () => {
    const before = [row({ Receipt_Number: 'A' }), row({ Receipt_Number: 'B', Receipt_Status: 'I' })];
    const after = [row({ Receipt_Number: 'B', Receipt_Status: 'C' }), row({ Receipt_Number: 'C' })];
    const result = diffReportRows(before, after, keyOf);
    expect(result.changed.map((c) => c.key)).toEqual(['B']);
    expect(result.added.map((r) => r.Receipt_Number)).toEqual(['C']);
    expect(result.removed.map((r) => r.Receipt_Number)).toEqual(['A']);
  });
});
