-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EntityKind" AS ENUM ('CA', 'CAMPAIGN', 'PARTY');

-- CreateEnum
CREATE TYPE "ReceivedBy" AS ENUM ('GPO', 'ENTITY');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('ISSUED', 'CANCELLED', 'VOID');

-- CreateEnum
CREATE TYPE "ReceiptDelivery" AS ENUM ('EMAIL', 'MAIL');

-- CreateEnum
CREATE TYPE "ReceiptNumberSource" AS ENUM ('SEQUENCE', 'FOREIGN');

-- CreateEnum
CREATE TYPE "PeriodKind" AS ENUM ('ANNUAL', 'GENERAL_ELECTION', 'BY_ELECTION');

-- CreateEnum
CREATE TYPE "ContributionStatusKind" AS ENUM ('valid', 'unpaid', 'reimbursed', 'bank_error', 'other');

-- CreateEnum
CREATE TYPE "ContributionLimitBucket" AS ENUM ('PARTY', 'CA', 'CAMPAIGN', 'LEADERSHIP', 'CANDIDATE_SELF');

-- CreateEnum
CREATE TYPE "WorkItemKind" AS ENUM ('VALIDATION', 'DIFF', 'OWED_TO_EO', 'SYNC_INCIDENT');

-- CreateEnum
CREATE TYPE "WorkItemStatus" AS ENUM ('OPEN', 'RESOLVED', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "RtdFilingKind" AS ENUM ('INITIAL', 'DC1A_AMENDMENT');

-- CreateEnum
CREATE TYPE "RtdFilingFormat" AS ENUM ('CSV', 'PIPE');

-- CreateEnum
CREATE TYPE "EntityReportKind" AS ENUM ('ALL', 'S2P2');

-- CreateEnum
CREATE TYPE "EOFormKind" AS ENUM ('CANCELLATION', 'DC1', 'DC1A', 'OTHER');

-- CreateEnum
CREATE TYPE "ArtifactKind" AS ENUM ('PDF', 'CSV', 'FORM');

-- CreateEnum
CREATE TYPE "ReconciliationMarkKind" AS ENUM ('PAYOUT', 'BANK_DEPOSIT', 'TRANSFER');

-- CreateEnum
CREATE TYPE "SpaceStage" AS ENUM ('intake', 'queue_clear', 'reconciled', 'issued', 'delivered', 'reported', 'sent_to_cfo');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('sysadmin', 'party_cfo', 'administrator', 'rules_authority', 'bookkeeper', 'filer', 'process_owner', 'organizer', 'cfo', 'readonly');

-- CreateEnum
CREATE TYPE "ChangeLogSubjectType" AS ENUM ('Contribution', 'ContributionMetadata', 'Contact', 'AddressSnapshot', 'Receipt', 'ReceiptAllocation', 'RtdFiling', 'RtdInclusion', 'EntityReport', 'EOForm', 'WorkItem', 'Period', 'ContributionLimit', 'DonorCyclePreference', 'SpaceState', 'ReconciliationMark', 'User', 'IssuanceKillSwitch');

-- CreateTable
CREATE TABLE "contact" (
    "id" TEXT NOT NULL,
    "qomonContactId" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "addresses" JSONB NOT NULL DEFAULT '[]',
    "lastSyncedAt" TIMESTAMP(3),
    "syncHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "address_snapshot" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "periodId" INTEGER NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'CA',
    "source" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "address_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contribution" (
    "id" TEXT NOT NULL,
    "qomonTransactionId" BIGINT NOT NULL,
    "qomonBundleId" BIGINT,
    "contactId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'cad',
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "paymentMethodKind" TEXT,
    "statusKind" "ContributionStatusKind" NOT NULL DEFAULT 'valid',
    "codeCampaign" TEXT,
    "comment" TEXT,
    "externalRef" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3),
    "syncHash" TEXT,
    "deletedInQomonAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contribution_metadata" (
    "id" TEXT NOT NULL,
    "contributionId" TEXT NOT NULL,
    "periodId" INTEGER NOT NULL,
    "ridingNumber" INTEGER,
    "entityKind" "EntityKind" NOT NULL,
    "receivedBy" "ReceivedBy" NOT NULL,
    "goodsServices" BOOLEAN NOT NULL DEFAULT false,
    "nonDeductibleCents" INTEGER NOT NULL DEFAULT 0,
    "processedDate" TIMESTAMP(3),
    "sourceCode" TEXT NOT NULL DEFAULT '',
    "eoContributorId" TEXT,
    "exceptionReason" TEXT,
    "checksum" TEXT,
    "syncedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contribution_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_sequence" (
    "prefix" TEXT NOT NULL,
    "counter" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipt_sequence_pkey" PRIMARY KEY ("prefix")
);

-- CreateTable
CREATE TABLE "receipt" (
    "id" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "numberSource" "ReceiptNumberSource" NOT NULL DEFAULT 'SEQUENCE',
    "status" "ReceiptStatus" NOT NULL DEFAULT 'ISSUED',
    "lost" BOOLEAN NOT NULL DEFAULT false,
    "replacedById" TEXT,
    "reissuedFromId" TEXT,
    "ridingNumber" INTEGER,
    "entityKind" "EntityKind" NOT NULL,
    "periodId" INTEGER NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "contactId" TEXT NOT NULL,
    "contactNameSnapshot" TEXT NOT NULL,
    "addressSnapshotId" TEXT NOT NULL,
    "delivery" "ReceiptDelivery" NOT NULL DEFAULT 'MAIL',
    "deliveredAt" TIMESTAMP(3),
    "pdfArtifactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_allocation" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "contributionId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PeriodKind" NOT NULL,
    "ridingNumbers" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contribution_limit" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "bucket" "ContributionLimitBucket" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contribution_limit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rtd_inclusion" (
    "id" TEXT NOT NULL,
    "contributionId" TEXT NOT NULL,
    "rtdFilingId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "aggregateAfterCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rtd_inclusion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rtd_filing" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "RtdFilingKind" NOT NULL DEFAULT 'INITIAL',
    "format" "RtdFilingFormat" NOT NULL DEFAULT 'CSV',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "submittedBy" TEXT,
    "artifactId" TEXT,
    "amendsFilingId" TEXT,

    CONSTRAINT "rtd_filing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_report" (
    "id" TEXT NOT NULL,
    "ridingNumber" INTEGER,
    "entityKind" "EntityKind" NOT NULL,
    "periodId" INTEGER NOT NULL,
    "kind" "EntityReportKind" NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "artifactId" TEXT,
    "includedSet" JSONB NOT NULL DEFAULT '{}',
    "sentToCfoAt" TIMESTAMP(3),
    "supersededById" TEXT,
    "dirty" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "entity_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_report_receipt" (
    "entityReportId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,

    CONSTRAINT "entity_report_receipt_pkey" PRIMARY KEY ("entityReportId","receiptId")
);

-- CreateTable
CREATE TABLE "eo_form" (
    "id" TEXT NOT NULL,
    "kind" "EOFormKind" NOT NULL,
    "subject" TEXT NOT NULL,
    "receiptId" TEXT,
    "rtdFilingId" TEXT,
    "artifactId" TEXT,
    "filedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eo_form_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_log_entry" (
    "id" TEXT NOT NULL,
    "subjectType" "ChangeLogSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "reason" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlationId" TEXT NOT NULL,

    CONSTRAINT "change_log_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifact" (
    "id" TEXT NOT NULL,
    "kind" "ArtifactKind" NOT NULL,
    "uri" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "byteSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_item" (
    "id" TEXT NOT NULL,
    "kind" "WorkItemKind" NOT NULL,
    "subjectType" "ChangeLogSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "contactId" TEXT,
    "ruleRef" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" "WorkItemStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeUserId" TEXT,
    "resolutionNote" TEXT,
    "formArtifactId" TEXT,
    "correlationId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "work_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donor_cycle_preference" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "delivery" "ReceiptDelivery" NOT NULL DEFAULT 'MAIL',
    "precheckSentAt" TIMESTAMP(3),
    "addressConfirmedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "donor_cycle_preference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "space_state" (
    "id" TEXT NOT NULL,
    "periodId" INTEGER NOT NULL,
    "ridingNumber" INTEGER,
    "entityKind" "EntityKind" NOT NULL,
    "stage" "SpaceStage" NOT NULL DEFAULT 'intake',
    "stageOwner" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "space_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_mark" (
    "id" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "kind" "ReconciliationMarkKind" NOT NULL,
    "statementDate" TIMESTAMP(3) NOT NULL,
    "amountCentsMatched" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "reconciliation_mark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_match" (
    "id" TEXT NOT NULL,
    "reconciliationMarkId" TEXT NOT NULL,
    "contributionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'readonly',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isCfoDesignate" BOOLEAN NOT NULL DEFAULT false,
    "ridingGrants" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "allRidings" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issuance_kill_switch" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "engaged" BOOLEAN NOT NULL DEFAULT false,
    "engagedAt" TIMESTAMP(3),
    "engagedBy" TEXT,
    "reason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "issuance_kill_switch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_day_calendar" (
    "year" INTEGER NOT NULL,
    "holidays" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_day_calendar_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "session" (
    "sid" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_qomonContactId_key" ON "contact"("qomonContactId");

-- CreateIndex
CREATE INDEX "address_snapshot_contactId_periodId_idx" ON "address_snapshot"("contactId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "contribution_qomonTransactionId_key" ON "contribution"("qomonTransactionId");

-- CreateIndex
CREATE INDEX "contribution_contactId_idx" ON "contribution"("contactId");

-- CreateIndex
CREATE INDEX "contribution_acceptedAt_idx" ON "contribution"("acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "contribution_metadata_contributionId_key" ON "contribution_metadata"("contributionId");

-- CreateIndex
CREATE INDEX "contribution_metadata_periodId_idx" ON "contribution_metadata"("periodId");

-- CreateIndex
CREATE INDEX "contribution_metadata_ridingNumber_entityKind_idx" ON "contribution_metadata"("ridingNumber", "entityKind");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_receiptNumber_key" ON "receipt"("receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_replacedById_key" ON "receipt"("replacedById");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_reissuedFromId_key" ON "receipt"("reissuedFromId");

-- CreateIndex
CREATE INDEX "receipt_periodId_idx" ON "receipt"("periodId");

-- CreateIndex
CREATE INDEX "receipt_contactId_idx" ON "receipt"("contactId");

-- CreateIndex
CREATE INDEX "receipt_status_idx" ON "receipt"("status");

-- CreateIndex
CREATE INDEX "receipt_allocation_contributionId_idx" ON "receipt_allocation"("contributionId");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_allocation_receiptId_contributionId_key" ON "receipt_allocation"("receiptId", "contributionId");

-- CreateIndex
CREATE UNIQUE INDEX "contribution_limit_year_bucket_key" ON "contribution_limit"("year", "bucket");

-- CreateIndex
CREATE INDEX "rtd_inclusion_contributionId_idx" ON "rtd_inclusion"("contributionId");

-- CreateIndex
CREATE INDEX "rtd_inclusion_rtdFilingId_idx" ON "rtd_inclusion"("rtdFilingId");

-- CreateIndex
CREATE UNIQUE INDEX "rtd_filing_name_key" ON "rtd_filing"("name");

-- CreateIndex
CREATE UNIQUE INDEX "entity_report_supersededById_key" ON "entity_report"("supersededById");

-- CreateIndex
CREATE INDEX "entity_report_periodId_ridingNumber_entityKind_idx" ON "entity_report"("periodId", "ridingNumber", "entityKind");

-- CreateIndex
CREATE INDEX "change_log_entry_subjectType_subjectId_idx" ON "change_log_entry"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "change_log_entry_correlationId_idx" ON "change_log_entry"("correlationId");

-- CreateIndex
CREATE INDEX "change_log_entry_at_idx" ON "change_log_entry"("at");

-- CreateIndex
CREATE INDEX "work_item_kind_status_idx" ON "work_item"("kind", "status");

-- CreateIndex
CREATE INDEX "work_item_subjectType_subjectId_idx" ON "work_item"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "work_item_correlationId_idx" ON "work_item"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "donor_cycle_preference_contactId_year_key" ON "donor_cycle_preference"("contactId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "space_state_periodId_ridingNumber_entityKind_key" ON "space_state"("periodId", "ridingNumber", "entityKind");

-- CreateIndex
CREATE INDEX "reconciliation_mark_externalRef_idx" ON "reconciliation_mark"("externalRef");

-- CreateIndex
CREATE INDEX "reconciliation_match_contributionId_idx" ON "reconciliation_match"("contributionId");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_match_reconciliationMarkId_contributionId_key" ON "reconciliation_match"("reconciliationMarkId", "contributionId");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE INDEX "session_expiresAt_idx" ON "session"("expiresAt");

-- AddForeignKey
ALTER TABLE "address_snapshot" ADD CONSTRAINT "address_snapshot_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "address_snapshot" ADD CONSTRAINT "address_snapshot_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution" ADD CONSTRAINT "contribution_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_metadata" ADD CONSTRAINT "contribution_metadata_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "contribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_metadata" ADD CONSTRAINT "contribution_metadata_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_addressSnapshotId_fkey" FOREIGN KEY ("addressSnapshotId") REFERENCES "address_snapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_reissuedFromId_fkey" FOREIGN KEY ("reissuedFromId") REFERENCES "receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_pdfArtifactId_fkey" FOREIGN KEY ("pdfArtifactId") REFERENCES "artifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_allocation" ADD CONSTRAINT "receipt_allocation_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_allocation" ADD CONSTRAINT "receipt_allocation_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "contribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rtd_inclusion" ADD CONSTRAINT "rtd_inclusion_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "contribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rtd_inclusion" ADD CONSTRAINT "rtd_inclusion_rtdFilingId_fkey" FOREIGN KEY ("rtdFilingId") REFERENCES "rtd_filing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rtd_filing" ADD CONSTRAINT "rtd_filing_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "artifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rtd_filing" ADD CONSTRAINT "rtd_filing_amendsFilingId_fkey" FOREIGN KEY ("amendsFilingId") REFERENCES "rtd_filing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_report" ADD CONSTRAINT "entity_report_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_report" ADD CONSTRAINT "entity_report_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "artifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_report" ADD CONSTRAINT "entity_report_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "entity_report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_report_receipt" ADD CONSTRAINT "entity_report_receipt_entityReportId_fkey" FOREIGN KEY ("entityReportId") REFERENCES "entity_report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_report_receipt" ADD CONSTRAINT "entity_report_receipt_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eo_form" ADD CONSTRAINT "eo_form_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eo_form" ADD CONSTRAINT "eo_form_rtdFilingId_fkey" FOREIGN KEY ("rtdFilingId") REFERENCES "rtd_filing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eo_form" ADD CONSTRAINT "eo_form_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "artifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_log_entry" ADD CONSTRAINT "change_log_entry_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_formArtifactId_fkey" FOREIGN KEY ("formArtifactId") REFERENCES "artifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donor_cycle_preference" ADD CONSTRAINT "donor_cycle_preference_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_state" ADD CONSTRAINT "space_state_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_match" ADD CONSTRAINT "reconciliation_match_reconciliationMarkId_fkey" FOREIGN KEY ("reconciliationMarkId") REFERENCES "reconciliation_mark"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_match" ADD CONSTRAINT "reconciliation_match_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "contribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

