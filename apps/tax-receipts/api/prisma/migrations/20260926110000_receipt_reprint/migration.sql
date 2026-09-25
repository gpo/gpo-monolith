-- Receipt reprints (corrections.md action 3, ticket 3.11): the lost-receipt
-- Copy and the typo-only lightweight reprint. A receipt's own PDF is frozen
-- once issued (invariant 7), so a reproduction lives in its own table.

-- CreateEnum
CREATE TYPE "ReceiptReprintKind" AS ENUM ('LOST_COPY', 'CORRECTED');

-- CreateTable
CREATE TABLE "receipt_reprint" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "kind" "ReceiptReprintKind" NOT NULL,
    "correctedName" TEXT,
    "artifactId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_reprint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "receipt_reprint_receiptId_idx" ON "receipt_reprint"("receiptId");

-- AddForeignKey
ALTER TABLE "receipt_reprint" ADD CONSTRAINT "receipt_reprint_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_reprint" ADD CONSTRAINT "receipt_reprint_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "artifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariant 4: reprints are never hard-deleted
CREATE TRIGGER no_hard_delete_receipt_reprint
  BEFORE DELETE ON receipt_reprint
  FOR EACH ROW EXECUTE FUNCTION trg_no_hard_delete();
