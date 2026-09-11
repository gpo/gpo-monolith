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

describe('deriveIntakeDefaults (1.1 stub, pending ticket 1.6)', () => {
  it('resolves period_id from the acceptance date and flags everything else', () => {
    const result = deriveIntakeDefaults({
      acceptedAt: new Date('2026-03-01T12:00:00Z'),
      codeCampaign: 'NC.W.DON.DBK.BTN50',
      externalRef: 'ch_3PqK',
      periods,
    });

    expect(result.periodId).toBe(67);
    expect(result.flagged).toBe(true);
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
      external_ref: 'ch_3PqK',
    });
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
    expect(result.flagged).toBe(true);
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
    expect(result.flagReason).toMatch(/ambiguous/);
  });
});
