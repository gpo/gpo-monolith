import { describe, expect, it } from 'vitest';
import {
  computeMetadataChecksum,
  descriptiveChanged,
  type GpoMetadataDescriptive,
} from './metadata.js';

const descriptive: GpoMetadataDescriptive = {
  period_id: 67,
  riding_number: 84,
  entity_kind: 'CA',
  received_by: 'GPO',
  goods_services: false,
  non_deductible_cents: 0,
  processed_date: null,
  source_code: 'NC.W.DON.DBK.BTN50',
  eo_contributor_id: null,
  exception_reason: null,
  external_ref: 'ch_3PqK',
};

describe('metadata checksum', () => {
  it('is stable regardless of key order', () => {
    const reordered = Object.fromEntries(
      Object.entries(descriptive).reverse(),
    ) as unknown as GpoMetadataDescriptive;
    expect(computeMetadataChecksum(reordered)).toBe(
      computeMetadataChecksum(descriptive),
    );
  });

  it('changes when a descriptive field changes', () => {
    expect(
      computeMetadataChecksum({ ...descriptive, non_deductible_cents: 2500 }),
    ).not.toBe(computeMetadataChecksum(descriptive));
  });

  it('descriptiveChanged detects an external edit and treats no cache as changed', () => {
    const checksum = computeMetadataChecksum(descriptive);
    expect(descriptiveChanged(checksum, descriptive)).toBe(false);
    expect(descriptiveChanged(checksum, { ...descriptive, riding_number: 12 })).toBe(
      true,
    );
    expect(descriptiveChanged(null, descriptive)).toBe(true);
  });
});
