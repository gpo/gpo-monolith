import {
  computeContributionSyncHash,
  deriveIntakeDefaults,
  paymentMethodFromQomon,
  paymentStateFromQomonKind,
  type ContributionSyncFields,
  type GpoMetadataDescriptive,
  type IntakeFlag,
  type PeriodRow,
} from '@gpo/tax-receipts-core';
import {
  QomonNotFoundError,
  qomonToSyncedFields,
  type ChangeCursor,
  type ChangedTransaction,
  type ChangeFeedSource,
  type QomonApi,
  type QomonContact,
  type QomonSyncedFields,
  type QomonTransaction,
} from '@gpo/qomon-client';
import { withChangeLog } from '../changelog/write.js';
import { descriptiveToColumns } from '../contributions/metadata-cache.js';
import { createPaymentWithContribution } from '../payments/create.js';
import { runValidationForContribution } from '../validation/run.js';
import type { Prisma } from '../generated/prisma/index.js';
import type { PrismaClient } from '../generated/prisma/index.js';

/**
 * Qomon import sweep (ticket 1.1, reworked for D12; data-model §5): the
 * inbound half of the Qomon protocol. Qomon is an import source, not a
 * system of record: the sweep pages the change feed and, for each NEW
 * transaction, creates a Payment (with its QomonTransactionLink) and an
 * initial Contribution, applying the intake defaults from
 * `@gpo/tax-receipts-core`. It never writes to Qomon, and it never mutates a
 * payment or contribution it has already imported: a later Qomon edit only
 * refreshes the link's `syncHash` and opens a SYNC_INCIDENT work item for a
 * human to look at (open-questions.md O47 decides the eventual behaviour).
 *
 * Two modes, matching the data-model §5 flowchart:
 *  - `incremental` (default): resumes from the persisted {@link SyncCursor}
 *    row for this feed. Cheap; run frequently (design target: 15 min).
 *  - `full`: ignores the cursor, pulls the whole space, and — only when the
 *    pull was not truncated by `limit` — flags imported transactions that
 *    vanished from Qomon as sync incidents (invariant 4: never a silent
 *    deletion, and never a change to the payment or its contributions).
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

export interface ContactFetchFailure {
  qomonTransactionId: string;
  qomonContactId: number;
  message: string;
}

export interface MirrorSweepResult {
  mode: 'incremental' | 'full';
  pulled: number;
  /** new transactions imported as a Payment + initial Contribution */
  created: number;
  /** already-imported contributions whose missing metadata was backfilled
   *  now that a period resolves */
  backfilled: number;
  /** already-imported transactions Qomon has since edited (a sync incident
   *  was opened; nothing local was changed) */
  changedInQomon: number;
  unchanged: number;
  syncIncidents: number;
  cursor: ChangeCursor;
  hasMore: boolean;
  /** Transactions skipped this pass because Qomon 404'd their contact
   *  (dangling contact_id — see `ensureContact`). Not lost: an incremental
   *  sweep's cursor moves past them, but a `full` sweep re-pulls the whole
   *  feed and will retry every one of these until the contact resolves. */
  contactFetchFailures: ContactFetchFailure[];
}

const REASON_NEW_STUB = 'import sweep: new Qomon transaction, intake defaults applied';
const REASON_NEW_FROM_QOMON = 'import sweep: new Qomon transaction, metadata taken from Qomon on first sight';
const REASON_NEW_NO_PERIOD = 'import sweep: new Qomon transaction, no period resolves yet';
const REASON_BACKFILL = 'import sweep: metadata backfilled now that a period resolves';

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
  let backfilled = 0;
  let changedInQomon = 0;
  let unchanged = 0;
  const contactFetchFailures: ContactFetchFailure[] = [];

  for (const change of batch.changes) {
    try {
      const outcome = await ingestChange(prisma, qomon, periods, statusKindById, change);
      if (outcome === 'created') created += 1;
      else if (outcome === 'backfilled') backfilled += 1;
      else if (outcome === 'changed-in-qomon') changedInQomon += 1;
      else unchanged += 1;
    } catch (err) {
      // A dangling contact_id (Qomon 404s the contact a transaction points
      // at) shouldn't take the whole batch down with it — every other
      // change in this pull is still good. Skip and report; see
      // ContactFetchFailure above for how this transaction gets retried.
      if (err instanceof QomonNotFoundError) {
        contactFetchFailures.push({
          qomonTransactionId: String(change.transaction.id),
          qomonContactId: change.transaction.contact_id,
          message: err.message,
        });
        continue;
      }
      throw err;
    }
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
    backfilled,
    changedInQomon,
    unchanged,
    syncIncidents,
    cursor: batch.cursor,
    hasMore: batch.hasMore,
    contactFetchFailures,
  };
}

export type IngestOutcome = 'created' | 'backfilled' | 'changed-in-qomon' | 'unchanged';

/** One transaction through the import path. Exported so a caller (a test, a
 *  future single-transaction import) can run exactly what the sweep runs. */
export async function ingestChange(
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

  const link = await prisma.qomonTransactionLink.findUnique({
    where: { qomonTransactionId },
    include: { payment: { include: { contributions: true } } },
  });

  if (!link) {
    await ingestNewTransaction(prisma, qomon, periods, transaction, bundle, statusKind, syncHash);
    return 'created';
  }

  // Already imported: never mutate the payment or its contributions (D12).
  // A Qomon-side edit only moves the link's hash forward and asks a human to
  // look (O47); everything else is bookkeeping.
  if (link.syncHash !== syncHash) {
    await prisma.qomonTransactionLink.update({
      where: { id: link.id },
      data: { syncHash, lastSyncedAt: new Date() },
    });
    await openSyncIncidentWorkItem(prisma, link.payment);
    return 'changed-in-qomon';
  }

  // The tool's own derivation can still be incomplete: a contribution
  // imported before any period covered its date has no period. Backfill its
  // descriptive fields once one resolves (ticket 1.6), deriving from the
  // contribution's own recorded facts, never re-reading Qomon's copy.
  let backfilledAny = false;
  for (const contribution of link.payment.contributions) {
    if (contribution.status !== 'ACTIVE' || contribution.periodId !== null) continue;
    const touched = await backfillMetadataIfPossible(
      prisma,
      periods,
      contribution.id,
      contribution.acceptedAt,
      link.codeCampaign,
      link.payment.externalRef,
      contribution.contactId,
    );
    if (touched) {
      backfilledAny = true;
      // an edit re-runs the full rule registry (validation-rules.md "when
      // rules run: on edit")
      await runValidationForContribution(prisma, contribution.id);
    }
  }

  await prisma.qomonTransactionLink.update({
    where: { id: link.id },
    data: { lastSyncedAt: new Date() },
  });
  return backfilledAny ? 'backfilled' : 'unchanged';
}

async function ingestNewTransaction(
  prisma: PrismaClient,
  qomon: Pick<QomonApi, 'getContact'>,
  periods: PeriodRow[],
  transaction: QomonTransaction,
  bundle: ChangedTransaction['bundle'],
  statusKind: string,
  syncHash: string,
): Promise<void> {
  const contactId = await ensureContact(prisma, qomon, transaction.contact_id);
  const externalRef =
    transaction.external_transaction_id != null
      ? String(transaction.external_transaction_id)
      : null;
  const acceptedAt = new Date(transaction.date);

  // Descriptive fields are intake input only (data-model §3, D12): Qomon's
  // `extra_json` is read here, once, when it carries them; otherwise the
  // tool's own derivation supplies defaults and flags.
  const incoming = parseIncomingMetadata(transaction);
  let descriptive: GpoMetadataDescriptive | null = null;
  let flags: readonly IntakeFlag[] = [];
  let reason = REASON_NEW_FROM_QOMON;
  if (incoming) {
    descriptive = mergeSyncedWithLocalDefaults(incoming, externalRef);
  } else {
    const derived = deriveIntakeDefaults({
      acceptedAt,
      codeCampaign: transaction.code_campaign ?? null,
      externalRef,
      periods,
    });
    descriptive = derived.descriptive;
    flags = derived.flags;
    // else: no period resolves yet. The contribution imports with no
    // period (data-model §6: "never from a Qomon default"); the intake
    // flag work items below are how it surfaces, and a later sweep
    // backfills once a period is configured.
    reason = descriptive ? REASON_NEW_STUB : REASON_NEW_NO_PERIOD;
  }

  const { contribution } = await withChangeLog(prisma, { userId: null, reason }, (ctx) =>
    createPaymentWithContribution(ctx, {
      source: 'QOMON_IMPORT',
      contactId,
      amountCents: transaction.amount,
      receivedAt: acceptedAt,
      method: paymentMethodFromQomon(transaction.payment_method_kind),
      externalRef,
      state: paymentStateFromQomonKind(statusKind),
      note: transaction.comment ?? null,
      qomonLink: {
        qomonTransactionId: BigInt(transaction.id),
        qomonBundleId: bundle.id != null ? BigInt(bundle.id) : null,
        qomonPaymentMethodKind: transaction.payment_method_kind ?? null,
        codeCampaign: transaction.code_campaign ?? null,
        syncHash,
      },
      ...(descriptive ? { descriptive } : {}),
    }),
  );

  if (!incoming) await openIntakeFlagWorkItems(prisma, contribution.id, contactId, flags);

  // "on intake, all rules against the new row" (validation-rules.md). A
  // no-op when no period has resolved yet (runValidationForContribution
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
  codeCampaign: string | null,
  externalRef: string | null,
  contactId: string,
): Promise<boolean> {
  const derived = deriveIntakeDefaults({ acceptedAt, codeCampaign, externalRef, periods });
  if (!derived.descriptive) return false;
  await withChangeLog(prisma, { userId: null, reason: REASON_BACKFILL }, async (ctx) => {
    const before = await ctx.tx.contribution.findUniqueOrThrow({ where: { id: contributionId } });
    const after = await ctx.tx.contribution.update({
      where: { id: contributionId },
      data: descriptiveToColumns(derived.descriptive!),
    });
    await ctx.log({ subjectType: 'Contribution', subjectId: contributionId, before, after });
  });
  await openIntakeFlagWorkItems(prisma, contributionId, contactId, derived.flags);
  return true;
}

function contactFieldsFromQomon(fetched: QomonContact, fallbackId: number) {
  return {
    name: contactDisplayName(fetched, fallbackId),
    // Kept alongside `name` (ticket 4.1): the ALL/S2P2 EO reports need
    // Contributor_First_Name / Contributor_Last_Name as separate columns,
    // which the joined display name can't supply back apart.
    firstName: fetched.firstname?.trim() || null,
    lastName: fetched.surname?.trim() || null,
    email: fetched.mail ?? null,
    addresses: (fetched.address ? [fetched.address] : []) as Prisma.InputJsonValue,
  };
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
      ...contactFieldsFromQomon(fetched, qomonContactId),
      lastSyncedAt: new Date(),
    },
  });
  return created.id;
}

/**
 * Re-fetches one contact from Qomon and overwrites the cached name/email/
 * address. Deliberately separate from `ensureContact`, which the bulk sweep
 * uses and which fetches a contact only the first time it's seen (ticket
 * 1.1: bounding the sweep's Qomon call volume across potentially thousands
 * of already-known contacts). A single "Refresh donor from Qomon" click on one
 * contribution has no such volume concern, and "refresh, right now" should
 * actually mean that for the donor's address too — otherwise a corrected
 * address in Qomon can never reach a contact created before the fix.
 */
export async function refreshContactFromQomon(
  prisma: PrismaClient,
  qomon: Pick<QomonApi, 'getContact'>,
  contactId: string,
): Promise<void> {
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  // a contact with no Qomon link (development and testing only, D12) has
  // nothing to refresh from
  if (!contact || contact.qomonContactId === null) return;
  const qomonContactId = Number(contact.qomonContactId);
  const fetched = await qomon.getContact(qomonContactId);
  await prisma.contact.update({
    where: { id: contactId },
    data: { ...contactFieldsFromQomon(fetched, qomonContactId), lastSyncedAt: new Date() },
  });
}

function contactDisplayName(c: QomonContact, fallbackId: number): string {
  const parts = [c.firstname, c.surname].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(' ') : `Qomon contact ${fallbackId}`;
}

/** A Qomon-side edit or deletion of an imported transaction (O47): one open
 *  incident per payment, however many times Qomon changes it before a human
 *  looks. Never touches the payment or its contributions. */
async function openSyncIncidentWorkItem(
  prisma: PrismaClient,
  payment: { id: string; contactId: string },
): Promise<void> {
  const already = await prisma.workItem.findFirst({
    where: { kind: 'SYNC_INCIDENT', subjectType: 'Payment', subjectId: payment.id, status: 'OPEN' },
    select: { id: true },
  });
  if (already) return;
  await prisma.workItem.create({
    data: {
      kind: 'SYNC_INCIDENT',
      subjectType: 'Payment',
      subjectId: payment.id,
      contactId: payment.contactId,
    },
  });
}

async function detectDeletions(
  prisma: PrismaClient,
  seenQomonTransactionIds: Set<bigint>,
): Promise<number> {
  const mirrored = await prisma.qomonTransactionLink.findMany({
    where: { deletedInQomonAt: null },
    select: { id: true, qomonTransactionId: true, payment: { select: { id: true, contactId: true } } },
  });
  const missing = mirrored.filter((l) => !seenQomonTransactionIds.has(l.qomonTransactionId));
  if (missing.length === 0) return 0;

  for (const l of missing) {
    await prisma.qomonTransactionLink.update({
      where: { id: l.id },
      data: { deletedInQomonAt: new Date() },
    });
    await openSyncIncidentWorkItem(prisma, l.payment);
  }
  return missing.length;
}

/** Qomon's status `kind`, normalized for the sync hash: the documented enum
 *  is valid|unpaid|reimbursed|bank_error|other; the sandbox also returns e.g.
 *  "cancel" (types.ts) — anything outside it resolves to "other" rather than
 *  failing the sweep. Mapped to the tool's PaymentState at import. */
function resolveStatusKind(
  statusId: number | null | undefined,
  byId: Map<number, string>,
): string {
  const raw = statusId == null ? undefined : byId.get(statusId);
  return raw && KNOWN_STATUS_KINDS.has(raw) ? raw : 'other';
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

function parseIncomingMetadata(transaction: QomonTransaction): QomonSyncedFields | null {
  return qomonToSyncedFields(transaction.extra_json);
}

/** Combines Qomon's six synced fields with this tool's five local-only
 *  fields (see transaction-extra-fields.ts) to produce a full descriptive
 *  object. The local-only fields take the same static defaults
 *  intake-derivation uses (intake/defaults.ts) — never guessed beyond that. */
function mergeSyncedWithLocalDefaults(
  synced: QomonSyncedFields,
  externalRef: string | null,
): GpoMetadataDescriptive {
  return {
    ...synced,
    received_by: 'GPO',
    non_deductible_cents: 0,
    eo_contributor_id: null,
    exception_reason: null,
    external_ref: externalRef,
  };
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

export async function loadPeriods(prisma: PrismaClient): Promise<PeriodRow[]> {
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
