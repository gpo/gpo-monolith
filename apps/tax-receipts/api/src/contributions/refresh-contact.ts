import { QomonNotFoundError, type QomonApi } from '@gpo/qomon-client';
import { refreshContactFromQomon } from '../sync/mirror-sweep.js';
import { ContributionNotFoundError } from './metadata-edit.js';
import type { PrismaClient } from '../generated/prisma/index.js';

/**
 * "Refresh donor from Qomon" (ticket 3.1 follow-up, reworked for D12).
 *
 * Contacts stay Qomon-owned (data-model §1) and a receipt snapshots the
 * donor's address, so a corrected address in Qomon has to be able to reach
 * the tool before a receipt is issued. The bulk sweep fetches a contact only
 * the first time it sees it (to bound Qomon call volume), so this on-demand,
 * single-contact refresh is the way to pick up a later correction.
 *
 * Only the contact is refreshed. The payment and contribution are the
 * tool's own and are never re-read from Qomon.
 */

export type ContactRefreshOutcome = 'refreshed' | 'not-linked' | 'not-found-in-qomon';

export async function refreshContributionContact(
  prisma: PrismaClient,
  qomon: Pick<QomonApi, 'getContact'>,
  contributionId: string,
): Promise<ContactRefreshOutcome> {
  const contribution = await prisma.contribution.findUnique({
    where: { id: contributionId },
    include: { contact: { select: { id: true, qomonContactId: true } } },
  });
  if (!contribution) throw new ContributionNotFoundError(contributionId);

  // a contact with no Qomon link (development and testing only, D12) has
  // nothing to refresh from
  if (contribution.contact.qomonContactId === null) return 'not-linked';

  try {
    await refreshContactFromQomon(prisma, qomon, contribution.contact.id);
    return 'refreshed';
  } catch (err) {
    // a contact deleted in Qomon shouldn't fail the click; the cached copy
    // stays as it was (same tolerance the sweep gives a dangling contact_id)
    if (err instanceof QomonNotFoundError) return 'not-found-in-qomon';
    throw err;
  }
}
