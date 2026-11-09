import type { ReceiptStatus } from '../generated/prisma/index.js';

/** What a receipt's status reads as on screen: ISSUED, LOST, CANCELLED, or VOID.
 *
 *  A lost receipt is stored as status ISSUED with `lost` set (EO status L,
 *  corrections.md action 3): it stays a valid receipt, so every check for a
 *  live receipt keeps reading `status === 'ISSUED'`. Screens show it as LOST
 *  (EO evaluation rows 59 and 60), and the ALL report files it as L. A lost
 *  receipt that is later cancelled reads CANCELLED. */
export type ReceiptDisplayStatus = ReceiptStatus | 'LOST';

export function receiptDisplayStatus(receipt: { status: ReceiptStatus; lost: boolean }): ReceiptDisplayStatus {
  return receipt.status === 'ISSUED' && receipt.lost ? 'LOST' : receipt.status;
}
