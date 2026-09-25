-- D12: the tool owns payments and contributions; Qomon is an import source.
--
-- Splits the Qomon-shaped `contribution` row into
--   payment                 the money event (tool-owned)
--   qomon_transaction_link  import provenance (which Qomon transaction, what
--                           the sweep last saw)
--   contribution            the tax attribution, now versioned
-- and backfills one payment + one link per existing contribution so a
-- populated development database migrates without loss. The
-- contribution_metadata table folds into contribution in a later migration.

-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('QOMON_IMPORT', 'MANUAL', 'LEGACY_IMPORT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'CHEQUE', 'CASH', 'PAD', 'EFT', 'IN_KIND', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentState" AS ENUM ('RECEIVED', 'UNPAID', 'REFUNDED', 'BANK_ERROR', 'OTHER');

-- CreateEnum
CREATE TYPE "ContributionStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'REFUNDED');

-- AlterEnum
ALTER TYPE "ChangeLogSubjectType" ADD VALUE 'Payment';

-- AlterTable: a contact may lack a Qomon link in development and testing (D12)
ALTER TABLE "contact" ALTER COLUMN "qomonContactId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "payment" (
    "id" TEXT NOT NULL,
    "source" "PaymentSource" NOT NULL,
    "contactId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'cad',
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "payerName" TEXT,
    "externalRef" TEXT,
    "state" "PaymentState" NOT NULL DEFAULT 'RECEIVED',
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qomon_transaction_link" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "qomonTransactionId" BIGINT NOT NULL,
    "qomonBundleId" BIGINT,
    "qomonPaymentMethodKind" TEXT,
    "codeCampaign" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3),
    "syncHash" TEXT,
    "deletedInQomonAt" TIMESTAMP(3),

    CONSTRAINT "qomon_transaction_link_pkey" PRIMARY KEY ("id")
);

-- AlterTable: new contribution columns (paymentId is tightened after backfill)
ALTER TABLE "contribution"
ADD COLUMN     "correlationId" TEXT,
ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "paymentId" TEXT,
ADD COLUMN     "status" "ContributionStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "supersedesId" TEXT;

-- Backfill: one payment + one Qomon link per existing contribution. The
-- payment id is minted here and parked on the contribution row.
UPDATE "contribution"
SET "paymentId" = 'pay_' || replace(gen_random_uuid()::text, '-', '');

INSERT INTO "payment" (
  "id", "source", "contactId", "amountCents", "currency", "receivedAt",
  "method", "externalRef", "state", "note", "createdAt", "updatedAt"
)
SELECT
  c."paymentId",
  'QOMON_IMPORT',
  c."contactId",
  c."amountCents",
  c."currency",
  c."acceptedAt",
  CASE lower(coalesce(c."paymentMethodKind", ''))
    WHEN 'cb'       THEN 'CARD'
    WHEN 'cbtpe'    THEN 'CARD'
    WHEN 'card'     THEN 'CARD'
    WHEN 'che'      THEN 'CHEQUE'
    WHEN 'check'    THEN 'CHEQUE'
    WHEN 'cheque'   THEN 'CHEQUE'
    WHEN 'pre'      THEN 'PAD'
    WHEN 'vir'      THEN 'EFT'
    WHEN 'transfer' THEN 'EFT'
    WHEN 'esp'      THEN 'CASH'
    WHEN 'cash'     THEN 'CASH'
    ELSE 'OTHER'
  END::"PaymentMethod",
  c."externalRef",
  CASE c."statusKind"::text
    WHEN 'valid'      THEN 'RECEIVED'
    WHEN 'unpaid'     THEN 'UNPAID'
    WHEN 'reimbursed' THEN 'REFUNDED'
    WHEN 'bank_error' THEN 'BANK_ERROR'
    ELSE 'OTHER'
  END::"PaymentState",
  c."comment",
  c."createdAt",
  CURRENT_TIMESTAMP
FROM "contribution" c;

INSERT INTO "qomon_transaction_link" (
  "id", "paymentId", "qomonTransactionId", "qomonBundleId",
  "qomonPaymentMethodKind", "codeCampaign", "firstSeenAt", "lastSyncedAt",
  "syncHash", "deletedInQomonAt"
)
SELECT
  'qtl_' || replace(gen_random_uuid()::text, '-', ''),
  c."paymentId",
  c."qomonTransactionId",
  c."qomonBundleId",
  c."paymentMethodKind",
  c."codeCampaign",
  c."firstSeenAt",
  c."lastSyncedAt",
  c."syncHash",
  c."deletedInQomonAt"
FROM "contribution" c;

-- DropIndex
DROP INDEX "contribution_qomonTransactionId_key";

-- AlterTable: drop the Qomon-shaped columns now that the data has moved
ALTER TABLE "contribution"
DROP COLUMN "codeCampaign",
DROP COLUMN "comment",
DROP COLUMN "currency",
DROP COLUMN "deletedInQomonAt",
DROP COLUMN "externalRef",
DROP COLUMN "firstSeenAt",
DROP COLUMN "lastSyncedAt",
DROP COLUMN "paymentMethodKind",
DROP COLUMN "qomonBundleId",
DROP COLUMN "qomonTransactionId",
DROP COLUMN "statusKind",
DROP COLUMN "syncHash";

ALTER TABLE "contribution" ALTER COLUMN "paymentId" SET NOT NULL;

-- DropEnum
DROP TYPE "ContributionStatusKind";

-- CreateIndex
CREATE INDEX "payment_contactId_idx" ON "payment"("contactId");

-- CreateIndex
CREATE INDEX "payment_receivedAt_idx" ON "payment"("receivedAt");

-- CreateIndex
CREATE INDEX "payment_externalRef_idx" ON "payment"("externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "qomon_transaction_link_paymentId_key" ON "qomon_transaction_link"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "qomon_transaction_link_qomonTransactionId_key" ON "qomon_transaction_link"("qomonTransactionId");

-- CreateIndex
CREATE INDEX "contribution_paymentId_idx" ON "contribution"("paymentId");

-- CreateIndex
CREATE INDEX "contribution_status_idx" ON "contribution"("status");

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qomon_transaction_link" ADD CONSTRAINT "qomon_transaction_link_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution" ADD CONSTRAINT "contribution_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution" ADD CONSTRAINT "contribution_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution" ADD CONSTRAINT "contribution_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "contribution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- Invariant 4: payments and their Qomon links are never hard-deleted
-- ===========================================================================

CREATE TRIGGER no_hard_delete_payment
  BEFORE DELETE ON payment
  FOR EACH ROW EXECUTE FUNCTION trg_no_hard_delete();

CREATE TRIGGER no_hard_delete_qomon_transaction_link
  BEFORE DELETE ON qomon_transaction_link
  FOR EACH ROW EXECUTE FUNCTION trg_no_hard_delete();

-- ===========================================================================
-- Invariant 1 (payment half): Σ ACTIVE contributions ≤ the payment amount
-- ===========================================================================

CREATE OR REPLACE FUNCTION check_payment_sum(p_payment_id text) RETURNS void AS $$
DECLARE
  v_amount integer;
  v_active integer;
BEGIN
  SELECT p."amountCents" INTO v_amount FROM payment p WHERE p."id" = p_payment_id;
  IF v_amount IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(c."amountCents"), 0)
    INTO v_active
  FROM contribution c
  WHERE c."paymentId" = p_payment_id
    AND c."status" = 'ACTIVE';

  IF v_active > v_amount THEN
    RAISE EXCEPTION
      'invariant 1: payment % has active contributions of %c which exceed its amount of %c',
      p_payment_id, v_active, v_amount
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_payment_sum_from_contribution() RETURNS trigger AS $$
BEGIN
  PERFORM check_payment_sum(NEW."paymentId");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_payment_sum_from_payment() RETURNS trigger AS $$
BEGIN
  PERFORM check_payment_sum(NEW."id");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Deferred, like the allocation-sum triggers, so a multi-step correction
-- (supersede one contribution, open its replacements) is judged only at
-- commit, never mid-cascade.
CREATE CONSTRAINT TRIGGER payment_sum_on_contribution
  AFTER INSERT OR UPDATE ON contribution
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_payment_sum_from_contribution();

CREATE CONSTRAINT TRIGGER payment_sum_on_payment
  AFTER UPDATE ON payment
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD."amountCents" IS DISTINCT FROM NEW."amountCents")
  EXECUTE FUNCTION trg_payment_sum_from_payment();
