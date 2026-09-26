-- Ticket 3.6: delivery infrastructure. An email outbox (email_message) with
-- the provider's webhook events (email_event), print batches for the manual
-- print-and-mail path (print_batch, print_batch_item), and a DELIVERY work
-- item kind for a receipt email that bounced or failed.
--
-- None of these tables is guarded by invariant 5: the receipt-side effects
-- (deliveredAt, a flip to MAIL) are written to `receipt` through the
-- change-log path. They are delivery records, so invariant 4's never-delete
-- rule covers them (triggers at the bottom).

-- CreateEnum
CREATE TYPE "EmailPurpose" AS ENUM ('RECEIPT', 'PRECHECK');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'DELAYED', 'BOUNCED', 'COMPLAINED', 'FAILED');

-- AlterEnum
ALTER TYPE "WorkItemKind" ADD VALUE 'DELIVERY';

-- CreateTable
CREATE TABLE "email_message" (
    "id" TEXT NOT NULL,
    "purpose" "EmailPurpose" NOT NULL,
    "receiptId" TEXT,
    "contactId" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "textBody" TEXT NOT NULL,
    "htmlBody" TEXT,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "statusDetail" TEXT,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "queuedByUserId" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),

    CONSTRAINT "email_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_event" (
    "id" TEXT NOT NULL,
    "emailMessageId" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "detail" TEXT,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_batch" (
    "id" TEXT NOT NULL,
    "periodId" INTEGER NOT NULL,
    "ridingNumber" INTEGER,
    "entityKind" "EntityKind" NOT NULL,
    "artifactId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mailedAt" TIMESTAMP(3),
    "mailedByUserId" TEXT,

    CONSTRAINT "print_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_batch_item" (
    "id" TEXT NOT NULL,
    "printBatchId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "print_batch_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_message_providerMessageId_key" ON "email_message"("providerMessageId");

-- CreateIndex
CREATE INDEX "email_message_status_nextAttemptAt_idx" ON "email_message"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "email_message_receiptId_idx" ON "email_message"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "email_event_providerEventId_key" ON "email_event"("providerEventId");

-- CreateIndex
CREATE INDEX "email_event_emailMessageId_idx" ON "email_event"("emailMessageId");

-- CreateIndex
CREATE INDEX "print_batch_periodId_ridingNumber_entityKind_idx" ON "print_batch"("periodId", "ridingNumber", "entityKind");

-- CreateIndex
CREATE INDEX "print_batch_item_receiptId_idx" ON "print_batch_item"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "print_batch_item_printBatchId_receiptId_key" ON "print_batch_item"("printBatchId", "receiptId");

-- AddForeignKey
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_event" ADD CONSTRAINT "email_event_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "email_message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_batch" ADD CONSTRAINT "print_batch_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_batch" ADD CONSTRAINT "print_batch_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "artifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_batch_item" ADD CONSTRAINT "print_batch_item_printBatchId_fkey" FOREIGN KEY ("printBatchId") REFERENCES "print_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_batch_item" ADD CONSTRAINT "print_batch_item_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Invariant 4: delivery records are never hard-deleted.
CREATE TRIGGER no_hard_delete_email_message
  BEFORE DELETE ON email_message
  FOR EACH ROW EXECUTE FUNCTION trg_no_hard_delete();

CREATE TRIGGER no_hard_delete_email_event
  BEFORE DELETE ON email_event
  FOR EACH ROW EXECUTE FUNCTION trg_no_hard_delete();

CREATE TRIGGER no_hard_delete_print_batch
  BEFORE DELETE ON print_batch
  FOR EACH ROW EXECUTE FUNCTION trg_no_hard_delete();

CREATE TRIGGER no_hard_delete_print_batch_item
  BEFORE DELETE ON print_batch_item
  FOR EACH ROW EXECUTE FUNCTION trg_no_hard_delete();
