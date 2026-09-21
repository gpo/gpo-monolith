import { describe, expect, it } from 'vitest';
import {
  S2P2_REPORT_HEADER,
  S2P2_THRESHOLD_CENTS,
  buildS2p2Rows,
  formatS2p2Csv,
  type S2p2SourceRow,
} from './s2p2-report.js';

let nextReceiptId = 1;

function source(overrides: Partial<S2p2SourceRow> = {}): S2p2SourceRow {
  return {
    status: 'ISSUED',
    entityKind: 'PARTY',
    ridingNumber: null,
    periodId: 67,
    amountCents: 10_000,
    contactId: 'contact-1',
    eoContributorId: '198176',
    contributorLastName: 'Donor',
    contributorFirstName: 'Dana',
    addressLine1: '1 Main St',
    city: 'Toronto',
    province: 'ON',
    postalCode: 'M1M 1M1',
    receiptId: `receipt-${nextReceiptId++}`,
    ...overrides,
  };
}

const label = () => 'Green Party of Ontario';

describe('buildS2p2Rows', () => {
  it('sums multiple ISSUED rows for the same contributor+entity within a period', () => {
    const s1 = source({ amountCents: 15_000 });
    const s2 = source({ amountCents: 10_000 });
    const { rows, includedReceiptIds } = buildS2p2Rows([s1, s2], label);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.Aggregate_Contribution_Amount).toBe('250.00');
    expect(includedReceiptIds.sort()).toEqual([s1.receiptId, s2.receiptId].sort());
  });

  it('excludes cancelled and void rows from the aggregate (REP7), even though they still exist on ALL', () => {
    const issued = source({ amountCents: 25_000 });
    const cancelled = source({ amountCents: 10_000, status: 'CANCELLED' });
    const voided = source({ amountCents: 10_000, status: 'VOID' });
    const { rows, includedReceiptIds } = buildS2p2Rows([issued, cancelled, voided], label);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.Aggregate_Contribution_Amount).toBe('250.00');
    expect(includedReceiptIds).toEqual([issued.receiptId]);
  });

  it('excludes an aggregate of exactly $200.00 (strictly greater than required)', () => {
    const { rows, includedReceiptIds } = buildS2p2Rows([source({ amountCents: S2P2_THRESHOLD_CENTS })], label);
    expect(rows).toHaveLength(0);
    expect(includedReceiptIds).toEqual([]);
  });

  it('includes an aggregate one cent over $200', () => {
    const { rows } = buildS2p2Rows([source({ amountCents: S2P2_THRESHOLD_CENTS + 1 })], label);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.Aggregate_Contribution_Amount).toBe('200.01');
  });

  it('does not cross-aggregate the same contributor across different entities (per entity, not cross-entity)', () => {
    const { rows } = buildS2p2Rows(
      [
        source({ amountCents: 25_000, entityKind: 'CA', ridingNumber: 84 }),
        source({ amountCents: 25_000, entityKind: 'CAMPAIGN', ridingNumber: 84 }),
      ],
      label,
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.Aggregate_Contribution_Amount === '250.00')).toBe(true);
  });

  it('separates the same entity kind in two different ridings', () => {
    const { rows } = buildS2p2Rows(
      [
        source({ amountCents: 30_000, entityKind: 'CA', ridingNumber: 84, contactId: 'a' }),
        source({ amountCents: 30_000, entityKind: 'CA', ridingNumber: 85, contactId: 'a' }),
      ],
      (space) => `riding-${space.ridingNumber}`,
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.Political_Entity).sort()).toEqual(['riding-84', 'riding-85']);
  });

  it('includes G&S rows in the aggregate (REP8) with no special-casing needed', () => {
    const { rows } = buildS2p2Rows([source({ amountCents: 30_000 })], label);
    // buildS2p2Rows has no Contribution_Type input at all -- G&S and cash
    // rows are indistinguishable once ISSUED, which is exactly REP8's point.
    expect(rows[0]!.Aggregate_Contribution_Amount).toBe('300.00');
  });

  it('carries the ENTITY type letter in Contributor_Type, not the donor type like ALL', () => {
    const { rows } = buildS2p2Rows([source({ amountCents: 30_000, entityKind: 'CA', ridingNumber: 84 })], label);
    expect(rows[0]!.Contributor_Type).toBe('A');
    expect(rows[0]!.Political_Entity_Type).toBe('A');
  });

  it('never collapses distinct donors that both lack an eoContributorId (grouping is by contactId)', () => {
    const { rows } = buildS2p2Rows(
      [
        source({ amountCents: 30_000, contactId: 'contact-a', eoContributorId: null, contributorLastName: 'Alpha' }),
        source({ amountCents: 30_000, contactId: 'contact-b', eoContributorId: null, contributorLastName: 'Beta' }),
      ],
      label,
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.Contributor_Last_Name).sort()).toEqual(['Alpha', 'Beta']);
  });

  it('emits no rows at all when nothing in the period exceeds $200 (no file, not an empty one)', () => {
    const { rows } = buildS2p2Rows([source({ amountCents: 5_000 })], label);
    expect(rows).toEqual([]);
  });

  it('sorts deterministically by entity then last name then first name', () => {
    const { rows } = buildS2p2Rows(
      [
        source({ amountCents: 30_000, contactId: 'c1', contributorLastName: 'Zeta', entityKind: 'PARTY' }),
        source({ amountCents: 30_000, contactId: 'c2', contributorLastName: 'Alpha', entityKind: 'PARTY' }),
      ],
      label,
    );
    expect(rows.map((r) => r.Contributor_Last_Name)).toEqual(['Alpha', 'Zeta']);
  });
});

describe('formatS2p2Csv', () => {
  it('emits the exact 14-column header', () => {
    expect(S2P2_REPORT_HEADER).toHaveLength(14);
    expect(formatS2p2Csv([])).toBe(S2P2_REPORT_HEADER.join(',') + '\n');
  });

  it('has no date columns, unlike ALL', () => {
    expect(S2P2_REPORT_HEADER).not.toContain('Acceptance_Date');
    expect(S2P2_REPORT_HEADER).not.toContain('Receipt_Issuance_Date');
  });
});
