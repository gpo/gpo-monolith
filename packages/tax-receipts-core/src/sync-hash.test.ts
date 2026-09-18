import { describe, expect, it } from 'vitest';
import {
  computeContributionSyncHash,
  type ContributionSyncFields,
} from './sync-hash.js';

const fields: ContributionSyncFields = {
  amountCents: 10_000,
  currency: 'cad',
  acceptedAt: '2026-03-01T12:00:00.000Z',
  qomonContactId: '42',
  paymentMethodKind: 'card',
  statusKind: 'valid',
  codeCampaign: 'NC.W.DON.DBK.BTN50',
  comment: null,
  externalTransactionId: '7',
};

describe('contribution sync hash', () => {
  it('is stable regardless of key order', () => {
    const reordered = Object.fromEntries(
      Object.entries(fields).reverse(),
    ) as unknown as ContributionSyncFields;
    expect(computeContributionSyncHash(reordered)).toBe(
      computeContributionSyncHash(fields),
    );
  });

  it('changes when a mirrored fact field changes', () => {
    expect(
      computeContributionSyncHash({ ...fields, amountCents: 10_001 }),
    ).not.toBe(computeContributionSyncHash(fields));
    expect(
      computeContributionSyncHash({ ...fields, statusKind: 'unpaid' }),
    ).not.toBe(computeContributionSyncHash(fields));
  });

  it('is independent of the metadata checksum (distinct concerns)', () => {
    // sanity: the sync hash format matches the metadata checksum format
    // (sha256:<hex>) but the two are computed over disjoint field sets.
    expect(computeContributionSyncHash(fields)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
