/** What a receipt's status reads as on screen. A lost receipt is still ISSUED
 *  (and valid) underneath, with `lost` set; it reads LOST (EO status L), the
 *  same as the api's `receipts/display-status.ts`. */
export function receiptStatusLabel(receipt: { status: string; lost: boolean }): string {
  return receipt.status === 'ISSUED' && receipt.lost ? 'LOST' : receipt.status;
}
