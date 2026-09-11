import {
  computeContributionSyncHash,
  computeMetadataChecksum,
  deriveIntakeDefaults,
  descriptiveChanged,
  type ContributionSyncFields,
  type IntakeFlag,
  type PeriodRow,
  type QomonMetadataEnvelope,
} from '@gpo/tax-receipts-core';
import type {
  ChangeCursor,
  ChangedTransaction,
  ChangeFeedSource,
  QomonApi,
  QomonContact,
  QomonTransaction,
} from '@gpo/qomon-client';
import { withChangeLog } from '../changelog/write.js';
import { descriptiveToRow, isReceiptedOrReported } from '../contributions/metadata-cache.js';
import { runValidationForContribution } from '../validation/run.js';
import type { Prisma } from '../generated/prisma/index.js';
import type { ContributionStatusKind, PrismaClient } from '../generated/prisma/index.js';

/**
 * Mirror sweep (ticket 1.1, data-model §5): the inbound half of the Qomon
 * sync protocol. Pages the change feed, mirrors new transactions (applying
 * the ticket-1.6-stub intake defaults from `@gpo/tax-receipts-core`), detects
 * drift on already-mirrored ones, and routes anything touching a receipted
 * or RTD-reported contribution into the diff queue instead of silently
 * overwriting it.
 *
 * Two modes, matching the data-model §5 flowchart:
 *  - `incremental` (default): resumes from the persisted {@link SyncCursor}
 *    row for this feed. Cheap; run frequently (design target: 15 min).
 *  - `full`: ignores the cursor, pulls the whole space, and — only when the
 *    pull was not truncated by `limit` — flags contributions that vanished
 *    from Qomon as sync incidents (invariant 4: never a silent deletion).
 *    Run nightly.
 *
 * Contact sync is on-demand only (data-model §5): a contact is fetched the
 * first time the sweep sees a transaction for it. The nightly "contacts on
 * unissued receipts" refresh has no receipts to refresh yet (Phase 3) and is
 * deliberately out of scope here.
 */

export interface MirrorSweepDeps {
  prisma: PrismaClient;
  feed: ChangeFeedSource;
  qomon: Pick<QomonApi, 'getContact' | 'listTransactionStatuses'>;
}

export interface MirrorSweepOptions {
  mode?: 'incremental' | 'full';
  /** cap on transactions pulled this run. Defaults to 2000 (incremental) or
   *  100000 (full, so one call walks the whole space in the common case). */
  limit?: number;
}

export interface MirrorSweepResult {
  mode: 'incremental' | 'full';
  pulled: number;
  created: number;
  refreshed: number;
  diffQueued: number;
  unchanged: number;
  syncIncidents: number;
  cursor: ChangeCursor;
  hasMore: boolean;
}

const REASON_NEW_STUB = 'mirror sweep: new transaction, ticket-1.1 intake defaults applied';
const REASON_NEW_FROM_QOMON = 'mirror sweep: metadata cached from Qomon on first sight';
const REASON_REFRESH = 'mirror sweep: cache refreshed from Qomon (no receipt/RTD dependency)';
const REASON_BACKFILL = 'mirror sweep: metadata backfilled now that a period resolves';

const KNOWN_STATUS_KINDS: ReadonlySet<string> = new Set([
  'valid',
  'unpaid',
  'reimbursed',
  'bank_error',
  'other',
]);

export async function runMirrorSweep(
  deps: MirrorSweepDeps,
  opts: MirrorSweepOptions = {},
): Promise<MirrorSweepResult> {
  const mode = opts.mode ?? 'incremental';
  const { prisma, feed, qomon } = deps;

  const cursor = mode === 'full' ? null : await loadCursor(prisma, feed.kind);
  const limit = opts.limit ?? (mode === 'full' ? 100_000 : 2000);
  const batch = await feed.pull(cursor, { limit });

  const periods = await loadPeriods(prisma);
  const statuses = await qomon.listTransactionStatuses();
  const statusKindById = new Map(statuses.map((s) => [s.id, s.kind]));

  let created = 0;
  let refreshed = 0;
  let diffQueued = 0;
  let unchanged = 0;

  for (const change of batch.changes) {
    const outcome = await ingestChange(prisma, qomon, periods, statusKindById, change);
    if (outcome === 'created') created += 1;
    else if (outcome === 'refreshed') refreshed += 1;
    else if (outcome === 'diff-queued') diffQueued += 1;
    else unchanged += 1;
  }

  let syncIncidents = 0;
  if (mode === 'full' && !batch.hasMore) {
    const seen = new Set(batch.changes.map((c) => BigInt(c.transaction.id)));
    syncIncidents = await detectDeletions(prisma, seen);
  }

  await saveCursor(prisma, feed.kind, batch.cursor);

  return {
    mode,
    pulled: batch.changes.length,
    created,
    refreshed,
    diffQueued,
    unchanged,
    syncIncidents,
    cursor: batch.cursor,
    hasMore: batch.hasMore,
  };
}

type IngestOutcome = 'created' | 'refreshed' | 'diff-queued' | 'unchanged';

async function ingestChange(
  prisma: PrismaClient,
  qomon: Pick<QomonApi, 'getContact'>,
  periods: PeriodRow[],
  statusKindById: Map<number, string>,
  change: ChangedTransaction,
): Promise<IngestOutcome> {
  const { transaction, bundle } = change;
  const qomonTransactionId = BigInt(transaction.id);
  const statusKind = resolveStatusKind(transaction.status_id, statusKindById);
  const syncHash = computeContributionSyncHash(buildSyncFields(transaction, statusKind));

  const existing = await prisma.contribution.findUnique({
    where: { qomonTransactionId },
    include: { metadata: true },
  });

  if (!existing) {
    await ingestNewContribution(prisma, qomon, periods, transaction, bundle, statusKind, syncHash);
    return 'created';
  }

  const incoming = parseIncomingMetadata(transaction);
  const metadataMissing = existing.metadata === null;
  const metadataChanged = existing.metadata
    ? incoming !== null && descriptiveChanged(existing.metadata.checksum, incoming.gpo)
    : incoming !== null;
  const transactionChanged = existing.syncHash !== syncHash;

  // A contribution with no cached metadata is always worth re-checking (a
  // period may have been configured since the last sweep, ticket 1.6's
  // backfill path below), even when the Qomon-side facts didn't change.
  if (!transactionChanged && !metadataChanged && !metadataMissing) {
    await prisma.contribution.update({
      where: { id: existing.id },
      data: { lastSyncedAt: new Date() },
    });
    return 'unchanged';
  }

  if ((transactionChanged || metadataChanged) && (await isReceiptedOrReported(prisma, existing.id))) {
    await openDiffWorkItem(prisma, existing);
    // Facts are deliberately NOT overwritten here: this contribution backs an
    // ISSUED receipt or an RTD filing, so the change must go through the
    // correction workflow (corrections.md, Phase 3), not a silent cache
    // update. Re-detected every sweep until the diff is resolved.
    await prisma.contribution.update({
      where: { id: existing.id },
      data: { lastSyncedAt: new Date() },
    });
    return 'diff-queued';
  }

  await prisma.contribution.update({
    where: { id: existing.id },
    data: transactionChanged
      ? mirrorUpdateData(transaction, statusKind, syncHash)
      : { lastSyncedAt: new Date() },
  });

  let metadataTouched = false;
  if (incoming && metadataChanged) {
    await withChangeLog(prisma, { userId: null, reason: REASON_REFRESH }, async (ctx) => {
      const before = existing.metadata;
      const after = await ctx.tx.contributionMetadata.upsert({
        where: { contributionId: existing.id },
        create: {
          contributionId: existing.id,
          ...descriptiveToRow(incoming.gpo, computeMetadataChecksum(incoming.gpo)),
        },
        update: descriptiveToRow(incoming.gpo, computeMetadataChecksum(incoming.gpo)),
      });
      await ctx.log({
        subjectType: 'ContributionMetadata',
        subjectId: existing.id,
        before,
        after,
      });
    });
    metadataTouched = true;
  } else if (metadataMissing) {
    metadataTouched = await backfillMetadataIfPossible(
      prisma,
      periods,
      existing.id,
      existing.acceptedAt,
      transaction,
      existing.contactId,
    );
  }

  if (metadataTouched) {
    // an edit (external, since this is the sweep) re-runs the full rule
    // registry (validation-rules.md "when rules run: on edit")
    await runValidationForContribution(prisma, existing.id);
  }

  return transactionChanged || metadataTouched ? 'refreshed' : 'unchanged';
}

async function ingestNewContribution(
  prisma: PrismaClient,
  qomon: Pick<QomonApi, 'getContact'>,
  periods: PeriodRow[],
  transaction: QomonTransaction,
  bundle: ChangedTransaction['bundle'],
  statusKind: ContributionStatusKind,
  syncHash: string,
): Promise<void> {
  const contactId = await ensureContact(prisma, qomon, transaction.contact_id);
  const externalRef =
    transaction.external_transaction_id != null
      ? String(transaction.external_transaction_id)
      : null;

  const contribution = await prisma.contribution.create({
    data: {
      qomonTransactionId: BigInt(transaction.id),
      qomonBundleId: bundle.id != null ? BigInt(bundle.id) : null,
      contactId,
      amountCents: transaction.amount,
      currency: transaction.currency,
      acceptedAt: new Date(transaction.date),
      paymentMethodKind: transaction.payment_method_kind ?? null,
      statusKind,
      codeCampaign: transaction.code_campaign ?? null,
      comment: transaction.comment ?? null,
      externalRef,
      syncHash,
      lastSyncedAt: new Date(),
    },
  });

  const incoming = parseIncomingMetadata(transaction);
  if (incoming) {
    await withChangeLog(prisma, { userId: null, reason: REASON_NEW_FROM_QOMON }, async (ctx) => {
      const after = await ctx.tx.contributionMetadata.create({
        data: {
          contributionId: contribution.id,
          ...descriptiveToRow(incoming.gpo, computeMetadataChecksum(incoming.gpo)),
        },
      });
      await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contribution.id, after });
    });
  } else {
    const derived = deriveIntakeDefaults({
      acceptedAt: contribution.acceptedAt,
      codeCampaign: transaction.code_campaign ?? null,
      externalRef,
      periods,
    });
    if (derived.descriptive) {
      await withChangeLog(prisma, { userId: null, reason: REASON_NEW_STUB }, async (ctx) => {
        const after = await ctx.tx.contributionMetadata.create({
          data: {
            contributionId: contribution.id,
            ...descriptiveToRow(derived.descriptive!, null),
          },
        });
        await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contribution.id, after });
      });
    }
    // else: no period resolves yet. The contribution mirrors without
    // metadata (data-model §6: "never from a Qomon default"); the intake
    // flag work items below are how it surfaces, and a later sweep
    // backfills once a period is configured (the `!existing.metadata`
    // branch in ingestChange).
    await openIntakeFlagWorkItems(prisma, contribution.id, contactId, derived.flags);
  }

  // "on intake, all rules against the new row" (validation-rules.md). A
  // no-op when metadata is still missing (runValidationForContribution
  // returns null in that case).
  await runValidationForContribution(prisma, contribution.id);
}

/** One WorkItem per ticket-1.6 intake-derivation flag (a distinct concern
 *  from the validation-rules.md registry, data-model §6: "never a Qomon
 *  default" — these mark a field the sweep could not derive with
 *  confidence, not a rule violation). Not reconciled by the validation
 *  engine (run.ts excludes the `INTAKE:` ruleRef prefix): closing one is
 *  manual for now, pending a future re-derivation pass once B3/B8 clear. */
async function openIntakeFlagWorkItems(
  prisma: PrismaClient,
  contributionId: string,
  contactId: string,
  flags: readonly IntakeFlag[],
): Promise<void> {
  for (const flag of flags) {
    await prisma.workItem.create({
      data: {
        kind: 'VALIDATION',
        subjectType: 'Contribution',
        subjectId: contributionId,
        contactId,
        ruleRef: `INTAKE:${flag.field}`,
      },
    });
  }
}

async function backfillMetadataIfPossible(
  prisma: PrismaClient,
  periods: PeriodRow[],
  contributionId: string,
  acceptedAt: Date,
  transaction: QomonTransaction,
  contactId: string,
): Promise<boolean> {
  const derived = deriveIntakeDefaults({
    acceptedAt,
    codeCampaign: transaction.code_campaign ?? null,
    externalRef:
      transaction.external_transaction_id != null
        ? String(transaction.external_transaction_id)
        : null,
    periods,
  });
  if (!derived.descriptive) return false;
  await withChangeLog(prisma, { userId: null, reason: REASON_BACKFILL }, async (ctx) => {
    const after = await ctx.tx.contributionMetadata.create({
      data: { contributionId, ...descriptiveToRow(derived.descriptive!, null) },
    });
    await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contributionId, after });
  });
  await openIntakeFlagWorkItems(prisma, contributionId, contactId, derived.flags);
  return true;
}

async function ensureContact(
  prisma: PrismaClient,
  qomon: Pick<QomonApi, 'getContact'>,
  qomonContactId: number,
): Promise<string> {
  const id = BigInt(qomonContactId);
  const existing = await prisma.contact.findUnique({ where: { qomonContactId: id } });
  if (existing) return existing.id;

  const fetched = await qomon.getContact(qomonContactId);
  const created = await prisma.contact.create({
    data: {
      qomonContactId: id,
      name: contactDisplayName(fetched, qomonContactId),
      email: fetched.mail ?? null,
      addresses: (fetched.address ? [fetched.address] : []) as Prisma.InputJsonValue,
      lastSyncedAt: new Date(),
    },
  });
  return created.id;
}

function contactDisplayName(c: QomonContact, fallbackId: number): string {
  const parts = [c.firstname, c.surname].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(' ') : `Qomon contact ${fallbackId}`;
}

async function openDiffWorkItem(
  prisma: PrismaClient,
  existing: { id: string; contactId: string },
): Promise<void> {
  const already = await prisma.workItem.findFirst({
    where: { kind: 'DIFF', subjectType: 'Contribution', subjectId: existing.id, status: 'OPEN' },
    select: { id: true },
  });
  if (already) return;
  await prisma.workItem.create({
    data: {
      kind: 'DIFF',
      subjectType: 'Contribution',
      subjectId: existing.id,
      contactId: existing.contactId,
    },
  });
}

async function detectDeletions(
  prisma: PrismaClient,
  seenQomonTransactionIds: Set<bigint>,
): Promise<number> {
  const mirrored = await prisma.contribution.findMany({
    where: { deletedInQomonAt: null },
    select: { id: true, qomonTransactionId: true, contactId: true },
  });
  const missing = mirrored.filter((c) => !seenQomonTransactionIds.has(c.qomonTransactionId));
  if (missing.length === 0) return 0;

  for (const c of missing) {
    await prisma.contribution.update({
      where: { id: c.id },
      data: { deletedInQomonAt: new Date() },
    });
    await prisma.workItem.create({
      data: {
        kind: 'SYNC_INCIDENT',
        subjectType: 'Contribution',
        subjectId: c.id,
        contactId: c.contactId,
      },
    });
  }
  return missing.length;
}

function resolveStatusKind(
  statusId: number | null | undefined,
  byId: Map<number, string>,
): ContributionStatusKind {
  const raw = statusId == null ? undefined : byId.get(statusId);
  if (raw && KNOWN_STATUS_KINDS.has(raw)) return raw as ContributionStatusKind;
  // documented enum is valid|unpaid|reimbursed|bank_error|other; the sandbox
  // also returns e.g. "cancel" (types.ts) — anything outside our narrower
  // stored enum resolves to "other" rather than failing the sweep.
  return 'other';
}

function buildSyncFields(
  transaction: QomonTransaction,
  statusKind: string,
): ContributionSyncFields {
  return {
    amountCents: transaction.amount,
    currency: transaction.currency,
    acceptedAt: new Date(transaction.date).toISOString(),
    qomonContactId: String(transaction.contact_id),
    paymentMethodKind: transaction.payment_method_kind ?? null,
    statusKind,
    codeCampaign: transaction.code_campaign ?? null,
    comment: transaction.comment ?? null,
    externalTransactionId:
      transaction.external_transaction_id != null
        ? String(transaction.external_transaction_id)
        : null,
  };
}

function mirrorUpdateData(
  transaction: QomonTransaction,
  statusKind: ContributionStatusKind,
  syncHash: string,
) {
  return {
    amountCents: transaction.amount,
    currency: transaction.currency,
    acceptedAt: new Date(transaction.date),
    paymentMethodKind: transaction.payment_method_kind ?? null,
    statusKind,
    codeCampaign: transaction.code_campaign ?? null,
    comment: transaction.comment ?? null,
    externalRef:
      transaction.external_transaction_id != null
        ? String(transaction.external_transaction_id)
        : null,
    syncHash,
    lastSyncedAt: new Date(),
  };
}

function parseIncomingMetadata(transaction: QomonTransaction): QomonMetadataEnvelope | null {
  const m = transaction.metadata;
  if (!m || m.v !== 1) return null;
  return m;
}

async function loadCursor(prisma: PrismaClient, feedKind: string): Promise<ChangeCursor | null> {
  const row = await prisma.syncCursor.findUnique({ where: { feedKind } });
  if (!row) return null;
  return { since: row.since, token: row.token ?? undefined };
}

async function saveCursor(
  prisma: PrismaClient,
  feedKind: string,
  cursor: ChangeCursor,
): Promise<void> {
  await prisma.syncCursor.upsert({
    where: { feedKind },
    create: { feedKind, since: cursor.since, token: cursor.token ?? null },
    update: { since: cursor.since, token: cursor.token ?? null },
  });
}

async function loadPeriods(prisma: PrismaClient): Promise<PeriodRow[]> {
  const rows = await prisma.period.findMany();
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    ridingNumbers: p.ridingNumbers,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
  }));
}
