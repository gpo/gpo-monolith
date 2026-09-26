-- Live email sending guard (ticket 3.6 follow-up). Live sending needs both
-- email_delivery_settings.liveSendingEnabled (an admin toggle, off by
-- default) and the EMAIL_LIVE_SENDING_ALLOWED env flag. Otherwise the
-- dispatcher simulates the send and flags the row `simulated`.

-- AlterEnum
ALTER TYPE "ChangeLogSubjectType" ADD VALUE 'EmailDeliverySettings';

-- AlterTable
ALTER TABLE "email_message" ADD COLUMN     "simulated" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "email_delivery_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "liveSendingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_delivery_settings_pkey" PRIMARY KEY ("id")
);

