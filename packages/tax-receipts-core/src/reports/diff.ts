/**
 * Generic row-set diffing (ticket 4.5): compares a report's stored,
 * point-in-time snapshot of its rows against a freshly rebuilt set for the
 * same scope, keyed by an identity the caller supplies (`Receipt_Number` for
 * ALL, a composite for S2P2). This is rule E5's "dirty flag" made concrete —
 * "any included receipt changed" is exactly a `changed` entry below — and
 * screens.md screen 10's "diff view (exactly which included records changed
 * and why)" is exactly this function's `changed[].fields`.
 *
 * `added`/`removed` are informational, not part of E5's dirty condition: a
 * new receipt appearing in scope since generation isn't a correction to
 * something already sent, it's simply not yet reported. The caller (api
 * layer) treats `changed.length > 0` as the E5 dirty signal and surfaces
 * `added`/`removed` separately.
 */

export interface RowFieldDiff {
  field: string;
  before: string | number;
  after: string | number;
}

export interface RowDiff<Row> {
  key: string;
  before: Row;
  after: Row;
  fields: RowFieldDiff[];
}

export interface ReportRowDiffResult<Row> {
  changed: RowDiff<Row>[];
  added: Row[];
  removed: Row[];
}

export function diffReportRows<Row extends Record<string, string | number>>(
  before: readonly Row[],
  after: readonly Row[],
  keyOf: (row: Row) => string,
): ReportRowDiffResult<Row> {
  const beforeByKey = new Map(before.map((row) => [keyOf(row), row]));
  const afterByKey = new Map(after.map((row) => [keyOf(row), row]));

  const changed: RowDiff<Row>[] = [];
  const added: Row[] = [];
  const removed: Row[] = [];

  for (const [key, afterRow] of afterByKey) {
    const beforeRow = beforeByKey.get(key);
    if (!beforeRow) {
      added.push(afterRow);
      continue;
    }
    const fields = diffFields(beforeRow, afterRow);
    if (fields.length > 0) {
      changed.push({ key, before: beforeRow, after: afterRow, fields });
    }
  }
  for (const [key, beforeRow] of beforeByKey) {
    if (!afterByKey.has(key)) removed.push(beforeRow);
  }

  return { changed, added, removed };
}

function diffFields<Row extends Record<string, string | number>>(before: Row, after: Row): RowFieldDiff[] {
  const fields: RowFieldDiff[] = [];
  for (const key of Object.keys(after)) {
    if (before[key] !== after[key]) {
      fields.push({ field: key, before: before[key]!, after: after[key]! });
    }
  }
  return fields;
}
