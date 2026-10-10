export class ReceiptNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(readonly receiptId: string) {
    super(`receipt ${receiptId} not found`);
    this.name = 'ReceiptNotFoundError';
  }
}

/** A cancelled or void receipt is a closed record: nothing corrects,
 *  reprints, or otherwise changes a terminal receipt. */
export class TerminalReceiptError extends Error {
  readonly statusCode = 409;
  constructor(readonly receiptId: string, readonly status: string) {
    super(`receipt ${receiptId} is ${status}; a terminal receipt cannot be changed`);
    this.name = 'TerminalReceiptError';
  }
}
