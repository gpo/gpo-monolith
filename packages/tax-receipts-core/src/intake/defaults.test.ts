import { describe, expect, it } from 'vitest';
import type { PeriodRow } from '../period/calendar.js';
import { deriveIntakeDefaults } from './defaults.js';

const periods: PeriodRow[] = [
  {
    id: 67,
    name: '2026 Annual',
    kind: 'ANNUAL',
    ridingNumbers: [],
    startsAt: new Date('2026-01-01T05:00:00Z'),
    endsAt: new Date('2027-01-01T05:00:00Z'),
  },
];

describe('deriveIntakeDefaults (ticket 1.6, data-model §6)', () => {
  it('resolves period_id from the acceptance date and always flags entity_kind (B8)', () => {
    const result = deriveIntakeDefaults({
      acceptedAt: new Date('2026-03-01T12:00:00Z'),
      codeCampaign: 'NC.W.DON.DBK.BTN50', // party-level code: no directed riding segment
      externalRef: null,
      periods,
    });

    expect(result.periodId).toBe(67);
    expect(result.descriptive).toEqual({
      period_id: 67,
      riding_number: null,
      entity_kind: 'PARTY',
      received_by: 'GPO',
      goods_services: false,
      non_deductible_cents: 0,
      processed_date: null,
      source_code: 'NC.W.DON.DBK.BTN50',
      eo_contributor_id: null,
      exception_reason: null,
      external_ref: null,
    });
    expect(result.flags.map((f) => f.field).sort()).toEqual(['entity_kind', 'received_by', 'riding_number']);
  });

  it('derives riding_number from a directed source code (rule A7) and does not flag it', () => {
    const result = deriveIntakeDefaults({
      acceptedAt: new Date('2026-03-01T12:00:00Z'),
      codeCampaign: 'TSF.W.007',
      externalRef: null,
      periods,
    });
    expect(result.descriptive?.riding_number).toBe(7);
    expect(result.flags.some((f) => f.field === 'riding_number')).toBe(false);
  });

  it('ignores an out-of-range trailing numeric segment', () => {
    const result = deriveIntakeDefaults({
      acceptedAt: new Date('2026-03-01T12:00:00Z'),
      codeCampaign: 'XX.W.999',
      externalRef: null,
      periods,
    });
    expect(result.descriptive?.riding_number).toBeNull();
    expect(result.flags.some((f) => f.field === 'riding_number')).toBe(true);
  });

  it('prefers an already-known riding over source-code parsing', () => {
    const result = deriveIntakeDefaults({
      acceptedAt: new Date('2026-03-01T12:00:00Z'),
      ridingNumber: 42,
      codeCampaign: 'TSF.W.007',
      externalRef: null,
      periods,
    });
    expect(result.descriptive?.riding_number).toBe(42);
  });

  it('sets received_by GPO without flagging when a processor external_ref is present', () => {
    const result = deriveIntakeDefaults({
      acceptedAt: new Date('2026-03-01T12:00:00Z'),
      codeCampaign: null,
      externalRef: 'ch_3PqK',
      periods,
    });
    expect(result.descriptive?.received_by).toBe('GPO');
    expect(result.flags.some((f) => f.field === 'received_by')).toBe(false);
  });

  it('flags received_by when there is no processor record to key off', () => {
    const result = deriveIntakeDefaults({
      acceptedAt: new Date('2026-03-01T12:00:00Z'),
      codeCampaign: null,
      externalRef: null,
      periods,
    });
    expect(result.descriptive?.received_by).toBe('GPO');
    expect(result.flags.some((f) => f.field === 'received_by')).toBe(true);
  });

  it('always flags entity_kind (never derived from the space, D6; no unblocked source, B8)', () => {
    const result = deriveIntakeDefaults({
      acceptedAt: new Date('2026-03-01T12:00:00Z'),
      ridingNumber: 7,
      codeCampaign: 'TSF.W.007',
      externalRef: 'ch_3PqK',
      periods,
    });
    expect(result.descriptive?.entity_kind).toBe('PARTY');
    expect(result.flags).toEqual([
      {
        field: 'entity_kind',
        reason: expect.stringContaining('D6'),
      },
    ]);
  });

  it('falls back to an empty source_code when no code_campaign is present', () => {
    const result = deriveIntakeDefaults({
      acceptedAt: new Date('2026-03-01T12:00:00Z'),
      codeCampaign: null,
      externalRef: null,
      periods,
    });
    expect(result.descriptive?.source_code).toBe('');
  });

  it('flags with no metadata when no period covers the acceptance date (never a Qomon default)', () => {
    const result = deriveIntakeDefaults({
      acceptedAt: new Date('2020-01-01T00:00:00Z'),
      codeCampaign: null,
      externalRef: null,
      periods,
    });
    expect(result.periodId).toBeNull();
    expect(result.descriptive).toBeNull();
    expect(result.flags.some((f) => f.field === 'period_id')).toBe(true);
  });

  it('flags with no metadata when the acceptance date is ambiguous across periods', () => {
    const overlapping: PeriodRow[] = [
      ...periods,
      {
        id: 68,
        name: 'Overlap',
        kind: 'ANNUAL',
        ridingNumbers: [],
        startsAt: new Date('2026-01-01T05:00:00Z'),
        endsAt: new Date('2027-01-01T05:00:00Z'),
      },
    ];
    const result = deriveIntakeDefaults({
      acceptedAt: new Date('2026-03-01T12:00:00Z'),
      codeCampaign: null,
      externalRef: null,
      periods: overlapping,
    });
    expect(result.periodId).toBeNull();
    expect(result.descriptive).toBeNull();
    expect(result.flags.find((f) => f.field === 'period_id')?.reason).toMatch(/ambiguous/);
  });

  it('scopes a by-election period using a riding derived from the source code', () => {
    const withByElection: PeriodRow[] = [
      ...periods,
      {
        id: 90,
        name: 'By-election 7',
        kind: 'BY_ELECTION',
        ridingNumbers: [7],
        startsAt: new Date('2026-03-01T00:00:00Z'),
        endsAt: new Date('2026-04-01T00:00:00Z'),
      },
    ];
    const result = deriveIntakeDefaults({
      acceptedAt: new Date('2026-03-15T00:00:00Z'),
      codeCampaign: 'TSF.W.007',
      externalRef: null,
      periods: withByElection,
    });
    expect(result.periodId).toBe(90); // by-election wins over the annual period
    expect(result.descriptive?.riding_number).toBe(7);
  });
});
