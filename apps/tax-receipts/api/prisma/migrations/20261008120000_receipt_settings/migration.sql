-- Receipt rendering settings (EO evaluation row 56). receiptLayout picks
-- the receipt PDF layout: LEGACY (the default, the receipt as it has always
-- been drawn) or CONTRIBUTOR_TYPE (adds "Contributor Type: Individual"). An
-- administrator switches it, change-logged.

-- AlterEnum
ALTER TYPE "ChangeLogSubjectType" ADD VALUE 'ReceiptSettings';

-- CreateEnum
CREATE TYPE "ReceiptLayout" AS ENUM ('LEGACY', 'CONTRIBUTOR_TYPE');

-- CreateTable
CREATE TABLE "receipt_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "receiptLayout" "ReceiptLayout" NOT NULL DEFAULT 'LEGACY',
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipt_settings_pkey" PRIMARY KEY ("id")
);
