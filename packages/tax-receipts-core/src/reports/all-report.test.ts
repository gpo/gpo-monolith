import { describe, expect, it } from 'vitest';
import {
  ALL_REPORT_HEADER,
  buildAllReportRow,
  formatAllReportCsv,
  isAgencyContribution,
  politicalEntityTypeLetter,
  receiptStatusLetter,
  type AllReportSourceRow,
} from './all-report.js';

function baseSource(overrides: Partial<AllReportSourceRow> = {}): AllReportSourceRow {
  return {
    receiptNumber: 'GPO-00402510',
    status: 'ISSUED',
    entityKind: 'PARTY',
    periodId: 67,
    issueDate: new Date('2026-06-01T13:00:00Z'),
    amountCents: 342_500,
    acceptedAt: new Date('2026-05-15T16:00:00Z'),
    goodsServices: false,
    receivedBy: 'GPO',
    eoContributorId: '198176',
    contributorLastName: 'Donor',
    contributorFirstName: 'Dana',
    addressLine1: '1 Main St',
    city: 'Toronto',
    province: 'ON',
    postalCode: 'M1M 1M1',
    ...overrides,
  };
}

describe('politicalEntityTypeLetter', () => {
  it('maps PARTY/CA/CAMPAIGN to P/A/C per the filed-data distribution', () => {
    expect(politicalEntityTypeLetter('PARTY')).toBe('P');
    expect(politicalEntityTypeLetter('CA')).toBe('A');
    expect(politicalEntityTypeLetter('CAMPAIGN')).toBe('C');
  });
});

describe('receiptStatusLetter', () => {
  it('files ISSUED as I', () => {
    expect(receiptStatusLetter('ISSUED')).toBe('I');
  });
  it('files CANCELLED as C', () => {
    expect(receiptStatusLetter('CANCELLED')).toBe('C');
  });
  it('files VOID as C too (compliance.md: no separate void letter)', () => {
    expect(receiptStatusLetter('VOID')).toBe('C');
  });
  it('files an ISSUED receipt flagged lost as L (EO spec column D, O41)', () => {
    expect(receiptStatusLetter('ISSUED', true)).toBe('L');
  });
  it('files a lost receipt that was later cancelled as C', () => {
    expect(receiptStatusLetter('CANCELLED', true)).toBe('C');
  });
});

describe('isAgencyContribution', () => {
  it('is Y when GPO received centrally on behalf of a CA', () => {
    expect(isAgencyContribution('GPO', 'CA')).toBe(true);
  });
  it('is Y when GPO received centrally on behalf of a campaign', () => {
    expect(isAgencyContribution('GPO', 'CAMPAIGN')).toBe(true);
  });
  it('is N when GPO received a party-directed contribution (not agency)', () => {
    expect(isAgencyContribution('GPO', 'PARTY')).toBe(false);
  });
  it('is N when the entity itself received the money', () => {
    expect(isAgencyContribution('ENTITY', 'CA')).toBe(false);
  });
});

describe('buildAllReportRow', () => {
  it('maps a clean issued receipt', () => {
    const row = buildAllReportRow(baseSource(), 'Green Party of Ontario');
    expect(row).toEqual({
      Party_ID: 8,
      Contributor_ID: '198176',
      Receipt_Number: 'GPO-00402510',
      Receipt_Status: 'I',
      Agency_Contribution: 'N',
      General_Meetings: 'N',
      Political_Entity_Type: 'P',
      Political_Entity: 'Green Party of Ontario',
      Contribution_Amount: '3425.00',
      Contribution_Type: 'MO',
      Acceptance_Date: '05152026',
      Receipt_Issuance_Date: '06012026',
      Contribution_Period_ID: 67,
      Contributor_Type: 'I',
      Contributor_Last_Name: 'Donor',
      Contributor_First_Name: 'Dana',
      Organization_Name: '',
      Contributor_Address: '1 Main St',
      Contributor_City: 'Toronto',
      Contributor_Province: 'ON',
      Contributor_Postal_Code: 'M1M 1M1',
    });
  });

  it('retains a cancelled receipt as a full-value row with status C (REP7)', () => {
    const row = buildAllReportRow(
      baseSource({ status: 'CANCELLED', amountCents: 5_000 }),
      'Green Party of Ontario',
    );
    expect(row.Receipt_Status).toBe('C');
    expect(row.Contribution_Amount).toBe('50.00');
  });

  it('marks G&S as GS even though it is not cash-receipted (REP8 feeds off this)', () => {
    const row = buildAllReportRow(baseSource({ goodsServices: true }), 'Green Party of Ontario');
    expect(row.Contribution_Type).toBe('GS');
  });

  it('blanks Contributor_ID rather than fabricating one when unassigned', () => {
    const row = buildAllReportRow(baseSource({ eoContributorId: null }), 'Green Party of Ontario');
    expect(row.Contributor_ID).toBe('');
  });

  it('always emits Contributor_Type I and a blank Organization_Name (no corporate exception)', () => {
    const row = buildAllReportRow(baseSource(), 'Green Party of Ontario');
    expect(row.Contributor_Type).toBe('I');
    expect(row.Organization_Name).toBe('');
  });

  it('always emits General_Meetings as N (D10: GPO has no general-meeting-bundled contributions)', () => {
    const row = buildAllReportRow(baseSource(), 'Green Party of Ontario');
    expect(row.General_Meetings).toBe('N');
  });
});

describe('formatAllReportCsv', () => {
  it('emits the exact 21-column header in the spec order (D10: EO spec layout, General_Meetings included)', () => {
    const csv = formatAllReportCsv([]);
    expect(csv).toBe(ALL_REPORT_HEADER.join(',') + '\n');
    expect(ALL_REPORT_HEADER).toHaveLength(21);
  });

  it('round-trips a row as a comma-joined line', () => {
    const row = buildAllReportRow(baseSource(), 'Green Party of Ontario');
    const csv = formatAllReportCsv([row]);
    const lines = csv.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      '8,198176,GPO-00402510,I,N,N,P,Green Party of Ontario,3425.00,MO,05152026,06012026,67,I,Donor,Dana,,1 Main St,Toronto,ON,M1M 1M1',
    );
  });

  it('quotes a field that contains a comma (e.g. a campaign display name)', () => {
    const row = buildAllReportRow(
      baseSource(),
      '047 - Campaign to Elect Aislinn Clancy, 2025',
    );
    const csv = formatAllReportCsv([row]);
    expect(csv).toContain('"047 - Campaign to Elect Aislinn Clancy, 2025"');
  });
});
