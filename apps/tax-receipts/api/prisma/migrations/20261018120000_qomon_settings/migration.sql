-- Party-level Qomon settings, moved out of the environment
-- (QOMON_API_KEY / QOMON_API_BASE). Qomon is off until a system
-- administrator enables it in Admin > Qomon with an API key, so a fresh
-- database never talks to Qomon. Changes are change-logged without the key.

-- AlterEnum
ALTER TYPE "ChangeLogSubjectType" ADD VALUE 'QomonSettings';

-- CreateTable
CREATE TABLE "qomon_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "apiKey" TEXT NOT NULL DEFAULT '',
    "apiBase" TEXT NOT NULL DEFAULT 'https://incoming.qomon.app',
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qomon_settings_pkey" PRIMARY KEY ("id")
);
