import { randomUUID } from 'node:crypto';
import {
  buildAllReportRow,
  formatAllReportCsv,
  type AllReportSourceRow,
} from '@gpo/tax-receipts-core';
import { storeArtifact } from '../artifacts/store.js';
import { withChangeLog } from '../changelog/write.js';
import type { EntityKind, PrismaClient } from '../generated/prisma/index.js';

/**
 * ALL report generator (ticket 4.1): screens.md screen 10's per-entity file,
 * plus the combined all-entities file EO also expects (eo-reporting.md §2).
 * One generator serves both: omit `entityKind`/`ridingNumber` for the
 * combined file, supply them for one entity's own file. Column mapping and
 * derivations live in `@gpo/tax-receipts-core`'s `all-report.ts`
 * (pure/testable); this module is just the DB fetch, the political-entity
 * label wiring, and the artifact + EntityReport write.
 *
 * S2P2 (ticket 4.2) and the REP2-8 export gate (ticket 4.3) are separate
 * tickets — this generator does not block on validation findings; it reports
 * what is issued, at any status.
 */

export interface GenerateAllReportDeps {
  prisma: PrismaClient;
  storageDir: string;
}

export interface AllReportScope {
  periodId: number;
  /** both omitted (or both `undefined`) = the combined, all-entities file.
   *  Supply both for one entity's file: `ridingNumber: null` for PARTY,
   *  a riding number for CA/CAMPAIGN. */
  ridingNumber?: number | null;
  entityKind?: EntityKind;
}

export interface GenerateAllReportInput extends AllReportScope {
  actorUserId: string;
  reason: string;
  /** Resolves a space's EO-facing display name (e.g. "084 Parry Sound
   *  Muskoka", "047 - Campaign to Elect Aislinn Clancy - 2025"). No entity-
   *  name registry exists in the schema yet — the same gap ticket 3.1/3.12
   *  already flagged for `politicalEntityLabel` on issuance — so this is
   *  caller-supplied rather than guessed on a document filed with a
   *  regulator. Called once per distinct (ridingNumber, entityKind) pair the
   *  scope's receipts actually carry. */
  politicalEntityLabel: (space: { ridingNumber: number | null; entityKind: EntityKind }) => string;
}

/**
 * A receipt with more than one allocation (several contributions consolidated
 * onto one receipt) can't be reported yet: which contribution's accepted date
 * prints, and whose non-deductible amount governs, is an open question ticket
 * 3.1 already declined to guess at for issuance itself — it belongs with the
 * correction/consolidation workflow (tickets 3.10/3.11), not this generator.
 * No such receipt can exist today (3.1 and 3.12 only ever issue one
 * contribution -> one receipt), so this is a forward guard, not a live gap.
 */
export class MultiAllocationReceiptError extends Error {
  constructor(
    readonly receiptId: string,
    readonly receiptNumber: string,
    readonly allocationCount: number,
  ) {
    super(
      `receipt ${receiptNumber} has ${allocationCount} allocations; the ALL report generator only ` +
        'supports one contribution per receipt so far (see this file\'s MultiAllocationReceiptError doc comment)',
    );
    this.name = 'MultiAllocationReceiptError';
  }
}

/** `ridingNumber` and `entityKind` must both be supplied (one entity's file)
 *  or both omitted (the combined file) — a half-scoped call (e.g. a riding
 *  with no entity kind) isn't a file EO or any CFO asks for, so it's rejected
 *  rather than silently generating a `ridingNumber`-filtered but
 *  entity-kind-unfiltered mix. */
export class AllReportScopeError extends Error {
  constructor() {
    super('ridingNumber and entityKind must both be supplied (per-entity) or both omitted (combined)');
    this.name = 'AllReportScopeError';
  }
}

export class MissingContributionMetadataError extends Error {
  constructor(readonly receiptNumber: string, readonly contributionId: string) {
    super(
      `receipt ${receiptNumber}'s contribution ${contributionId} has no metadata; intake derivation ` +
        'has not resolved this row yet',
    );
    this.name = 'MissingContributionMetadataError';
  }
}

export interface GeneratedAllReport {
  entityReportId: string;
  artifactId: string;
  rowCount: number;
  csv: string;
}

export async function generateAllReport(
  deps: GenerateAllReportDeps,
  input: GenerateAllReportInput,
): Promise<GeneratedAllReport> {
  const { prisma } = deps;
  const hasEntityKind = input.entityKind !== undefined;
  const hasRidingNumber = input.ridingNumber !== undefined;
  if (hasEntityKind !== hasRidingNumber) {
    throw new AllReportScopeError();
  }

  const receipts = await prisma.receipt.findMany({
    where: {
      periodId: input.periodId,
      ...(input.entityKind !== undefined ? { entityKind: input.entityKind } : {}),
      ...(input.ridingNumber !== undefined ? { ridingNumber: input.ridingNumber } : {}),
    },
    include: {
      addressSnapshot: true,
      contact: true,
      allocations: { include: { contribution: { include: { metadata: true } } } },
    },
    orderBy: { receiptNumber: 'asc' },
  });

  const rows = receipts.map((receipt) => {
    if (receipt.allocations.length !== 1) {
      throw new MultiAllocationReceiptError(receipt.id, receipt.receiptNumber, receipt.allocations.length);
    }
    const allocation = receipt.allocations[0]!;
    const contribution = allocation.contribution;
    const metadata = contribution.metadata;
    if (!metadata) {
      throw new MissingContributionMetadataError(receipt.receiptNumber, contribution.id);
    }

    const source: AllReportSourceRow = {
      receiptNumber: receipt.receiptNumber,
      status: receipt.status,
      entityKind: receipt.entityKind,
      periodId: receipt.periodId,
      issueDate: receipt.issueDate,
      amountCents: allocation.amountCents,
      acceptedAt: contribution.acceptedAt,
      goodsServices: metadata.goodsServices,
      receivedBy: metadata.receivedBy,
      eoContributorId: metadata.eoContributorId,
      // Qomon's own name split (ticket 4.1's Contact.firstName/lastName),
      // not a heuristic parse of the joined display name. Falls back to the
      // joined name in the last-name slot on the rare contact Qomon never
      // split (e.g. org-only), so the row still carries an identifiable
      // name rather than an empty one.
      contributorLastName: receipt.contact.lastName ?? receipt.contact.name,
      contributorFirstName: receipt.contact.firstName ?? '',
      addressLine1: [receipt.addressSnapshot.line1, receipt.addressSnapshot.line2]
        .filter((part): part is string => Boolean(part))
        .join(' '),
      city: receipt.addressSnapshot.city,
      province: receipt.addressSnapshot.province,
      postalCode: receipt.addressSnapshot.postalCode,
    };
    const label = input.politicalEntityLabel({
      ridingNumber: receipt.ridingNumber,
      entityKind: receipt.entityKind,
    });
    return buildAllReportRow(source, label);
  });

  const csv = formatAllReportCsv(rows);
  const artifact = await storeArtifact(deps, {
    kind: 'CSV',
    bytes: Buffer.from(csv, 'utf8'),
    extension: 'csv',
  });

  const correlationId = randomUUID();
  const entityReport = await withChangeLog(
    prisma,
    { userId: input.actorUserId, reason: input.reason, correlationId },
    async (ctx) => {
      const created = await ctx.tx.entityReport.create({
        data: {
          ridingNumber: input.ridingNumber ?? null,
          entityKind: input.entityKind ?? null,
          periodId: input.periodId,
          kind: 'ALL',
          artifactId: artifact.id,
          includedSet: { receiptIds: receipts.map((r) => r.id) },
        },
      });
      await ctx.log({
        subjectType: 'EntityReport',
        subjectId: created.id,
        after: { artifactId: artifact.id, rowCount: rows.length, kind: 'ALL' },
      });
      if (receipts.length > 0) {
        await ctx.tx.entityReportReceipt.createMany({
          data: receipts.map((r) => ({ entityReportId: created.id, receiptId: r.id })),
        });
      }
      return created;
    },
  );

  return { entityReportId: entityReport.id, artifactId: artifact.id, rowCount: rows.length, csv };
}
