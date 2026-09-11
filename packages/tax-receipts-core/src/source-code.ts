/**
 * Source-code parsing (validation-rules.md rule A7). Directed source codes
 * embed the riding as a numeric segment, e.g. `TSF.W.007`, `CND.W.012`; a
 * general/party-level code like `NC.W.DON.DBK.BTN50` (glossary.md: "middle
 * letter is channel, last segment the appeal") has no such segment — its
 * last segment isn't purely numeric, so it correctly parses to nothing.
 *
 * Shared by ticket 1.6 (intake derivation: use it as a riding source when
 * subspace-based derivation is unavailable) and ticket 1.7 (rule A7 itself:
 * compare the parsed riding against the stored metadata riding).
 */

const RIDING_MIN = 1;
const RIDING_MAX = 124;

/** Only the LAST dot-separated segment is checked. Convention is
 *  zero-padded (`007`) but this accepts any all-digit segment in the valid
 *  riding range, so an under-padded code isn't silently dropped. */
export function parseRidingFromSourceCode(sourceCode: string | null): number | null {
  if (!sourceCode) return null;
  const segments = sourceCode.split('.');
  const last = segments[segments.length - 1];
  if (!last || !/^\d+$/.test(last)) return null;
  const n = Number(last);
  if (n < RIDING_MIN || n > RIDING_MAX) return null;
  return n;
}
