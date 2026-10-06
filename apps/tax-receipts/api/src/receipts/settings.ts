import { withChangeLog, type ActorContext } from '../changelog/write.js';
import type { PrismaClient, ReceiptLayout } from '../generated/prisma/index.js';

/**
 * Receipt rendering settings (singleton row, `ReceiptSettings`). Read by
 * every path that renders a receipt PDF (issue, reissue, lost or corrected
 * reprint, correction cascades), so a change applies to the next PDF
 * rendered, never to one already stored.
 *
 * `receiptLayout`: `LEGACY` (the default) draws the receipt as it has
 * always been drawn; `CONTRIBUTOR_TYPE` adds "Contributor Type: Individual"
 * (EO evaluation row 56). See `pdf.ts`.
 */

const SINGLETON_ID = 'singleton';

export interface ReceiptSettingsView {
  receiptLayout: ReceiptLayout;
  updatedByUserId: string | null;
  updatedAt: Date | null;
}

export async function getReceiptSettings(prisma: PrismaClient): Promise<ReceiptSettingsView> {
  const row = await prisma.receiptSettings.findUnique({ where: { id: SINGLETON_ID } });
  return {
    receiptLayout: row?.receiptLayout ?? 'LEGACY',
    updatedByUserId: row?.updatedByUserId ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function setReceiptLayout(
  prisma: PrismaClient,
  actor: ActorContext,
  receiptLayout: ReceiptLayout,
): Promise<ReceiptSettingsView> {
  await withChangeLog(prisma, actor, async (ctx) => {
    const before = await ctx.tx.receiptSettings.findUnique({ where: { id: SINGLETON_ID } });
    const after = await ctx.tx.receiptSettings.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, receiptLayout, updatedByUserId: actor.userId },
      update: { receiptLayout, updatedByUserId: actor.userId },
    });
    await ctx.log({
      subjectType: 'ReceiptSettings',
      subjectId: SINGLETON_ID,
      before: { receiptLayout: before?.receiptLayout ?? 'LEGACY' },
      after: { receiptLayout: after.receiptLayout },
    });
  });
  return getReceiptSettings(prisma);
}
