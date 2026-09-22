import { describe, expect, it } from 'vitest';
import {
  RTD_FILING_HEADER,
  buildRtdFilingRow,
  formatRtdFilingCsv,
  formatRtdFilingPipe,
  type RtdFilingSourceRow,
} from './filing.js';

function source(overrides: Partial<RtdFilingSourceRow> = {}): RtdFilingSourceRow {
  return {
    contributionYear: 2026,
    periodId: 67,
    contributorLastName: 'Donor',
    contributorFirstName: 'Dana',
    acceptedAt: new Date('2026-03-05T12:00:00Z'),
    amountCents: 20_001,
    aggregateAfterCents: 20_001,
    eoContributorId: null,
    ...overrides,
  };
}

describe('buildRtdFilingRow (ticket 2.6)', () => {
  it('maps a source row onto EO\'s 10 confirmed column names', () => {
    const row = buildRtdFilingRow(source(), 'Casey CFO');
    expect(row).toEqual({
      'Entity ID': 8,
      'CFO Name': 'Casey CFO',
      'Contribution Year': 2026,
      'Contribution Period ID': 67,
      'Contributor Last Name': 'Donor',
      'Contributor First Name': 'Dana',
      'Deposit Date': '03052026',
      'Contribution Amount': '200.01',
      'Aggregate Contribution Amount': '200.01',
      'Contributor ID': '',
    });
  });

  it('emits a blank Contributor ID rather than fabricating one (O38)', () => {
    const row = buildRtdFilingRow(source({ eoContributorId: 'DON-42' }), 'Casey CFO');
    expect(row['Contributor ID']).toBe('DON-42');
  });
});

describe('formatRtdFilingCsv / formatRtdFilingPipe (ticket 2.6)', () => {
  const rows = [buildRtdFilingRow(source(), 'Casey CFO')];

  it('emits the header row exactly as confirmed against EO\'s 2026 example file', () => {
    const csv = formatRtdFilingCsv(rows);
    expect(csv.split('\n')[0]).toBe(RTD_FILING_HEADER.join(','));
  });

  it('comma-delimits the CSV form', () => {
    const csv = formatRtdFilingCsv(rows);
    expect(csv).toBe(
      'Entity ID,CFO Name,Contribution Year,Contribution Period ID,Contributor Last Name,' +
        'Contributor First Name,Deposit Date,Contribution Amount,Aggregate Contribution Amount,Contributor ID\n' +
        '8,Casey CFO,2026,67,Donor,Dana,03052026,200.01,200.01,\n',
    );
  });

  it('pipe-delimits the alternate .txt form with the same header text', () => {
    const pipe = formatRtdFilingPipe(rows);
    expect(pipe.split('\n')[0]).toBe(RTD_FILING_HEADER.join('|'));
    expect(pipe).toContain('8|Casey CFO|2026|67|Donor|Dana|03052026|200.01|200.01|');
  });

  it('quotes a field that contains the active delimiter', () => {
    const csv = formatRtdFilingCsv([buildRtdFilingRow(source(), 'Casey, CFO')]);
    expect(csv).toContain('"Casey, CFO"');
    const pipe = formatRtdFilingPipe([buildRtdFilingRow(source({ contributorLastName: 'Do|nor' }), 'Casey CFO')]);
    expect(pipe).toContain('"Do|nor"');
  });
});
