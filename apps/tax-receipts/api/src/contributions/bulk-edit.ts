import type { GpoMetadataDescriptive } from '@gpo/tax-receipts-core';
import type { QomonApi } from '@gpo/qomon-client';
import {
  writeContributionMetadata,
  type MetadataWriteThroughDeps,
} from './metadata-write-through.js';
import type { PrismaClient } from '../generated/prisma/index.js';

/**
 * Bulk edit (ticket 1.4, screens.md 2 / PRD C2): one reason, one set of
 * field changes, applied to every selected contribution. Each row keeps its
 * OTHER metadata fields as they are — only the fields present in `changes`
 * move — but the write to Qomon is still whole-object per row (D4): this
 * merges server-side (current row + `changes`) precisely so the caller
 * never has to know a row's full metadata just to change one field of it.
 *
 * Each row goes through 1.2's `writeContributionMetadata` unchanged, so it
 * gets the same write-first protocol, the same block on a receipted/
 * reported contribution, and its own change-log entry (PRD C2's "one
 * change-log entry per row"). One row's failure doesn't stop the rest —
 * "per-row progress" here means the full per-row result set returned after
 * the batch completes, not a live-streaming progress bar (no job queue /
 * SSE infrastructure exists yet to stream it); the web UI renders that set
 * as a list once the request resolves.
 */

export interface BulkMetadataChanges {
  periodId?: number;
  ridingNumber?: number | null;
  entityKind?: GpoMetadataDescriptive['entity_kind'];
  receivedBy?: GpoMetadataDescriptive['received_by'];
  goodsServices?: boolean;
  nonDeductibleCents?: number;
  processedDate?: string | null;
  sourceCode?: string;
  eoContributorId?: string | null;
  exceptionReason?: string | null;
  externalRef?: string | null;
}

const CHANGE_KEYS = [
  'periodId',
  'ridingNumber',
  'entityKind',
  'receivedBy',
  'goodsServices',
  'nonDeductibleCents',
  'processedDate',
  'sourceCode',
  'eoContributorId',
  'exceptionReason',
  'externalRef',
] as const satisfies readonly (keyof BulkMetadataChanges)[];

/** Cap on one batch: keeps a single HTTP request's synchronous processing
 *  time bounded (qomon-client self-throttles to 5 rps by default). */
export const BULK_EDIT_MAX_ROWS = 500;

export interface BulkEditInput {
  contributionIds: string[];
  actorUserId: string;
  reason: string;
  /** only include the fields you want to change; an absent key leaves that
   *  field as each row already has it. */
  changes: BulkMetadataChanges;
}

export interface BulkEditRowResult {
  contributionId: string;
  ok: boolean;
  error?: string;
}

export interface BulkEditResult {
  results: BulkEditRowResult[];
  succeeded: number;
  failed: number;
}

export class BulkEditTooLargeError extends Error {
  readonly statusCode = 413;
  constructor(count: number) {
    super(`bulk edit of ${count} rows exceeds the ${BULK_EDIT_MAX_ROWS}-row limit`);
    this.name = 'BulkEditTooLargeError';
  }
}

export class BulkEditEmptyChangesError extends Error {
  readonly statusCode = 400;
  constructor() {
    super('at least one field must be present in changes');
    this.name = 'BulkEditEmptyChangesError';
  }
}

function mergeDescriptive(
  current: {
    periodId: number;
    ridingNumber: number | null;
    entityKind: string;
    receivedBy: string;
    goodsServices: boolean;
    nonDeductibleCents: number;
    processedDate: Date | null;
    sourceCode: string;
    eoContributorId: string | null;
    exceptionReason: string | null;
  },
  externalRefCurrent: string | null,
  changes: BulkMetadataChanges,
): GpoMetadataDescriptive {
  return {
    period_id: changes.periodId ?? current.periodId,
    riding_number: 'ridingNumber' in changes ? (changes.ridingNumber ?? null) : current.ridingNumber,
    entity_kind: (changes.entityKind ?? current.entityKind) as GpoMetadataDescriptive['entity_kind'],
    received_by: (changes.receivedBy ?? current.receivedBy) as GpoMetadataDescriptive['received_by'],
    goods_services: changes.goodsServices ?? current.goodsServices,
    non_deductible_cents: changes.nonDeductibleCents ?? current.nonDeductibleCents,
    processed_date:
      'processedDate' in changes
        ? (changes.processedDate ?? null)
        : (current.processedDate?.toISOString().slice(0, 10) ?? null),
    source_code: changes.sourceCode ?? current.sourceCode,
    eo_contributor_id: 'eoContributorId' in changes ? (changes.eoContributorId ?? null) : current.eoContributorId,
    exception_reason: 'exceptionReason' in changes ? (changes.exceptionReason ?? null) : current.exceptionReason,
    external_ref: 'externalRef' in changes ? (changes.externalRef ?? null) : externalRefCurrent,
  };
}

export async function bulkEditContributionMetadata(
  deps: { prisma: PrismaClient; qomon: Pick<QomonApi, 'writeTransactionMetadata'> },
  input: BulkEditInput,
): Promise<BulkEditResult> {
  if (input.contributionIds.length > BULK_EDIT_MAX_ROWS) {
    throw new BulkEditTooLargeError(input.contributionIds.length);
  }
  if (!CHANGE_KEYS.some((k) => k in input.changes)) {
    throw new BulkEditEmptyChangesError();
  }

  const results: BulkEditRowResult[] = [];
  for (const contributionId of input.contributionIds) {
    try {
      const current = await deps.prisma.contribution.findUnique({
        where: { id: contributionId },
        include: { metadata: true },
      });
      if (!current) throw new Error('contribution not found');
      if (!current.metadata) {
        throw new Error('no metadata yet; intake derivation has not resolved this row');
      }

      const descriptive = mergeDescriptive(current.metadata, current.externalRef, input.changes);
      const writeDeps: MetadataWriteThroughDeps = { prisma: deps.prisma, qomon: deps.qomon };
      await writeContributionMetadata(writeDeps, {
        contributionId,
        actorUserId: input.actorUserId,
        reason: input.reason,
        descriptive,
      });
      results.push({ contributionId, ok: true });
    } catch (err) {
      results.push({
        contributionId,
        ok: false,
        error: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  return { results, succeeded, failed: results.length - succeeded };
}
