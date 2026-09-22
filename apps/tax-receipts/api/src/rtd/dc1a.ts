import {
  RTD_FILING_PARTY_ID,
  buildRtdFilingName,
  contributionYear,
  formatDc1aAmendmentForm,
} from '@gpo/tax-receipts-core';
import { storeArtifact, type ArtifactStoreDeps } from '../artifacts/store.js';
import { withChangeLog } from '../changelog/write.js';
import type { PrismaClient } from '../generated/prisma/index.js';

/**
 * DC-1A amendment generation (ticket 2.4): given a contribution that was
 * already RTD-reported (has an `RtdInclusion` from ticket 2.3's stamp) and a
 * reason, generates the amendment -- a new `RtdFiling` (kind
 * `DC1A_AMENDMENT`, `amendsFilingId` pointing at the ORIGINAL filing, never
 * at a prior amendment: corrections.md action 11 says "linked to the
 * original"), an `EOForm` (kind `DC1A`) and its `Artifact`, all in one
 * change-logged transaction.
 *
 * Decoupled from "owed-to-EO items" on purpose: `validation-rules.md`'s E2
 * and `corrections.md`'s action 11 both describe DC-1A amendments as
 * something the CORRECTION-ACTION flow produces (ticket 3.10) -- but that
 * flow isn't built yet, so nothing in the tool today can hand this function
 * a structured "owed-to-EO item" to consume (see stamp.ts's header comment
 * for the full trail). Rather than block on 3.10, this ships the generator
 * as its own callable unit, taking an explicit `contributionId` + `reason`;
 * `workItemId` is optional and, when a caller does have an open
 * `OWED_TO_EO` item to close (whether from a future 3.10, or opened by
 * hand today), resolves it with the new artifact attached
 * (`WorkItem.formArtifactId`).
 *
 * Does NOT write a new `RtdInclusion` row: that table is specifically the
 * primary-disclosure timeline (row inclusion + running aggregate, ticket
 * 2.2/2.3); a correction is recorded via the amendment filing and its form,
 * referencing the original inclusion, not a second disclosure event.
 */

export class ContributionNotRtdReportedError extends Error {
  constructor(readonly contributionId: string) {
    super(
      `contribution ${contributionId} has no RtdInclusion -- it was never RTD-reported, so a DC-1A doesn't apply ` +
        '(eo-reporting.md §1: "late-discovered unreported records go through a normal filing, not DC-1A")',
    );
    this.name = 'ContributionNotRtdReportedError';
  }
}

export class AmendmentWorkItemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmendmentWorkItemError';
  }
}

export interface GenerateDc1aAmendmentDeps extends ArtifactStoreDeps {
  prisma: PrismaClient;
}

export interface GenerateDc1aAmendmentInput {
  contributionId: string;
  /** mandatory (invariant 5; corrections.md action 11 requires a reason on
   *  every DC-1A). */
  reason: string;
  actorUserId: string;
  asOf?: Date;
  /** an open `OWED_TO_EO` WorkItem this amendment resolves. Optional --
   *  see this file's header comment for why nothing can supply one yet. */
  workItemId?: string;
}

export interface GeneratedDc1aAmendment {
  rtdFilingId: string;
  filingName: string;
  eoFormId: string;
  artifactId: string;
}

export async function generateDc1aAmendment(
  deps: GenerateDc1aAmendmentDeps,
  input: GenerateDc1aAmendmentInput,
): Promise<GeneratedDc1aAmendment> {
  const { prisma } = deps;
  const asOf = input.asOf ?? new Date();

  const contribution = await prisma.contribution.findUnique({
    where: { id: input.contributionId },
    include: {
      contact: true,
      metadata: true,
      rtdInclusions: { include: { rtdFiling: true } },
    },
  });
  const original = contribution?.rtdInclusions[0];
  if (!contribution || !original) {
    throw new ContributionNotRtdReportedError(input.contributionId);
  }
  const metadata = contribution.metadata;
  if (!metadata) {
    throw new ContributionNotRtdReportedError(input.contributionId); // unreachable: stamping requires metadata
  }

  let workItem = null;
  if (input.workItemId) {
    workItem = await prisma.workItem.findUnique({ where: { id: input.workItemId } });
    if (!workItem) throw new AmendmentWorkItemError(`no work item ${input.workItemId}`);
    if (workItem.kind !== 'OWED_TO_EO') {
      throw new AmendmentWorkItemError(`work item ${input.workItemId} is kind ${workItem.kind}, not OWED_TO_EO`);
    }
    if (workItem.status !== 'OPEN') {
      throw new AmendmentWorkItemError(`work item ${input.workItemId} is already ${workItem.status}`);
    }
  }

  const originalRecord = {
    contributorLastName: contribution.contact.lastName ?? contribution.contact.name,
    contributorFirstName: contribution.contact.firstName ?? '',
    acceptedAt: contribution.acceptedAt,
    amountCents: original.amountCents,
    aggregateAfterCents: original.aggregateAfterCents,
    contributionYear: contributionYear(contribution.acceptedAt),
    periodId: metadata.periodId,
    eoContributorId: metadata.eoContributorId,
  };

  const formText = formatDc1aAmendmentForm({
    originalFilingName: original.rtdFiling.name,
    originalRecord,
    reason: input.reason,
    submittedAt: asOf,
  });

  const artifact = await storeArtifact(deps, {
    kind: 'FORM',
    bytes: Buffer.from(formText, 'utf8'),
    extension: 'txt',
  });

  const filingName = buildRtdFilingName(originalRecord.contributionYear, RTD_FILING_PARTY_ID, asOf);

  const result = await withChangeLog(
    prisma,
    { userId: input.actorUserId, reason: input.reason },
    async (ctx) => {
      const filing = await ctx.tx.rtdFiling.create({
        data: {
          name: filingName,
          kind: 'DC1A_AMENDMENT',
          format: 'CSV',
          amendsFilingId: original.rtdFiling.id,
        },
      });
      const eoForm = await ctx.tx.eOForm.create({
        data: {
          kind: 'DC1A',
          subject: 'filing',
          rtdFilingId: filing.id,
          artifactId: artifact.id,
        },
      });
      await ctx.log({
        subjectType: 'RtdFiling',
        subjectId: filing.id,
        after: { name: filing.name, kind: filing.kind, amendsFilingId: filing.amendsFilingId },
      });
      await ctx.log({
        subjectType: 'EOForm',
        subjectId: eoForm.id,
        after: { kind: eoForm.kind, rtdFilingId: filing.id, artifactId: artifact.id },
      });

      if (workItem) {
        const before = workItem;
        const after = await ctx.tx.workItem.update({
          where: { id: workItem.id },
          data: {
            status: 'RESOLVED',
            resolutionNote: `DC-1A amendment generated (${filing.name})`,
            formArtifactId: artifact.id,
            closedAt: asOf,
          },
        });
        await ctx.log({ subjectType: 'WorkItem', subjectId: workItem.id, before, after });
      }

      return { rtdFilingId: filing.id, eoFormId: eoForm.id };
    },
  );

  return { ...result, filingName, artifactId: artifact.id };
}
