import { describe, expect, it } from 'vitest';
import * as core from '@gpo/tax-receipts-core';
import { $Enums } from '../generated/prisma/index.js';

/**
 * The Prisma schema mirrors packages/tax-receipts-core enums. If they drift,
 * the api will compile but produce rows the domain layer cannot represent.
 * This test is the guard (referenced from enums.ts).
 */
const pairs: Array<[string, readonly string[], readonly string[]]> = [
  ['EntityKind', core.EntityKind.options, Object.values($Enums.EntityKind)],
  ['ReceivedBy', core.ReceivedBy.options, Object.values($Enums.ReceivedBy)],
  ['ReceiptStatus', core.ReceiptStatus.options, Object.values($Enums.ReceiptStatus)],
  ['ReceiptDelivery', core.ReceiptDelivery.options, Object.values($Enums.ReceiptDelivery)],
  ['ReceiptNumberSource', core.ReceiptNumberSource.options, Object.values($Enums.ReceiptNumberSource)],
  ['PeriodKind', core.PeriodKind.options, Object.values($Enums.PeriodKind)],
  ['ContributionStatusKind', core.ContributionStatusKind.options, Object.values($Enums.ContributionStatusKind)],
  ['ContributionLimitBucket', core.ContributionLimitBucket.options, Object.values($Enums.ContributionLimitBucket)],
  ['WorkItemKind', core.WorkItemKind.options, Object.values($Enums.WorkItemKind)],
  ['WorkItemStatus', core.WorkItemStatus.options, Object.values($Enums.WorkItemStatus)],
  ['RtdFilingKind', core.RtdFilingKind.options, Object.values($Enums.RtdFilingKind)],
  ['RtdFilingFormat', core.RtdFilingFormat.options, Object.values($Enums.RtdFilingFormat)],
  ['EntityReportKind', core.EntityReportKind.options, Object.values($Enums.EntityReportKind)],
  ['EOFormKind', core.EOFormKind.options, Object.values($Enums.EOFormKind)],
  ['ArtifactKind', core.ArtifactKind.options, Object.values($Enums.ArtifactKind)],
  ['ReconciliationMarkKind', core.ReconciliationMarkKind.options, Object.values($Enums.ReconciliationMarkKind)],
  ['UserRole', core.UserRole.options, Object.values($Enums.UserRole)],
  ['ChangeLogSubjectType', core.ChangeLogSubjectType.options, Object.values($Enums.ChangeLogSubjectType)],
];

describe('Prisma <-> core enum parity', () => {
  it.each(pairs)('%s matches', (_name, coreOptions, prismaOptions) => {
    expect([...coreOptions].sort()).toEqual([...prismaOptions].sort());
  });

  it('SpaceStage matches (core uses hyphens, Prisma uses underscores)', () => {
    const normalized = Object.values($Enums.SpaceStage).map((s) =>
      s.replace(/_/g, '-'),
    );
    expect([...normalized].sort()).toEqual([...core.SpaceStage.options].sort());
  });
});
