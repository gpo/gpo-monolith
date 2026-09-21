/**
 * Shared EO-CSV formatting (factored out of ticket 4.1's ALL generator when
 * ticket 4.2 needed the identical behaviour for S2P2). Minimal RFC4180
 * quoting: a no-op on every field the verified facts (research/fixtures/
 * README.md) describe as comma/quote-free — the risk is confined to fields
 * with no such guarantee, like `Political_Entity`.
 *
 * Two assumptions neither ticket has been able to verify against the real
 * filed bytes yet (private, PII-bearing Drive files, no Drive access in this
 * build environment): this quoting convention, and the line ending (`\n`
 * here). See all-report.ts's header comment; confirm both before trusting
 * F1's byte-for-byte claim (test-plan.md).
 */
function csvField(value: string | number): string {
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function formatReportCsv<Column extends string>(
  header: readonly Column[],
  rows: readonly Record<Column, string | number>[],
): string {
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(header.map((col) => csvField(row[col])).join(','));
  }
  return lines.join('\n') + '\n';
}
