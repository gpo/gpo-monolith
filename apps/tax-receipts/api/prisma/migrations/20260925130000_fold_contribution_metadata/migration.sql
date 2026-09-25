-- D12, stage 2: fold contribution_metadata into contribution.
--
-- The metadata table existed only to mirror Qomon's metadata object (its
-- checksum and syncedAt are Qomon-sync bookkeeping that nothing reads any
-- more). The descriptive fields become ordinary columns on contribution;
-- data is backfilled first, then the invariant triggers that referenced the
-- old table move to the new home.
--
-- `periodId` stays nullable: a contribution imported before any period covers
-- its date has no period yet and awaits intake derivation (data-model §6).
-- Historical change_log_entry rows keep subjectType 'ContributionMetadata'
-- (the log is append-only); new writes log as 'Contribution'.

-- AlterTable
ALTER TABLE "contribution" ADD COLUMN     "entityKind" "EntityKind" NOT NULL DEFAULT 'PARTY',
ADD COLUMN     "eoContributorId" TEXT,
ADD COLUMN     "exceptionReason" TEXT,
ADD COLUMN     "goodsServices" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nonDeductibleCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "periodId" INTEGER,
ADD COLUMN     "processedDate" TIMESTAMP(3),
ADD COLUMN     "receivedBy" "ReceivedBy" NOT NULL DEFAULT 'GPO',
ADD COLUMN     "ridingNumber" INTEGER,
ADD COLUMN     "sourceCode" TEXT NOT NULL DEFAULT '';

-- Backfill from the old table (the guard triggers on contribution do not
-- exist yet, so this plain UPDATE is allowed).
UPDATE "contribution" c
SET "periodId" = m."periodId",
    "ridingNumber" = m."ridingNumber",
    "entityKind" = m."entityKind",
    "receivedBy" = m."receivedBy",
    "goodsServices" = m."goodsServices",
    "nonDeductibleCents" = m."nonDeductibleCents",
    "processedDate" = m."processedDate",
    "sourceCode" = m."sourceCode",
    "eoContributorId" = m."eoContributorId",
    "exceptionReason" = m."exceptionReason"
FROM "contribution_metadata" m
WHERE m."contributionId" = c."id";

-- Invariant 1 now reads the non-deductible amount from contribution itself.
CREATE OR REPLACE FUNCTION check_allocation_sum(p_contribution_id text) RETURNS void AS $$
DECLARE
  v_eligible integer;
  v_issued integer;
BEGIN
  SELECT c."amountCents" - c."nonDeductibleCents"
    INTO v_eligible
  FROM contribution c
  WHERE c."id" = p_contribution_id;

  IF v_eligible IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(a."amountCents"), 0)
    INTO v_issued
  FROM receipt_allocation a
  JOIN receipt r ON r."id" = a."receiptId"
  WHERE a."contributionId" = p_contribution_id
    AND r."status" = 'ISSUED';

  IF v_issued > v_eligible THEN
    RAISE EXCEPTION
      'invariant 1: contribution % has issued allocations of %c which exceed its eligible amount of %c',
      p_contribution_id, v_issued, v_eligible
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- The allocation-sum check fires when either input to "eligible" changes.
DROP TRIGGER allocation_sum_on_contribution ON contribution;
CREATE CONSTRAINT TRIGGER allocation_sum_on_contribution
  AFTER UPDATE ON contribution
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (
    OLD."amountCents" IS DISTINCT FROM NEW."amountCents"
    OR OLD."nonDeductibleCents" IS DISTINCT FROM NEW."nonDeductibleCents"
  )
  EXECUTE FUNCTION trg_alloc_sum_from_contribution();

-- DropForeignKey
ALTER TABLE "contribution_metadata" DROP CONSTRAINT "contribution_metadata_contributionId_fkey";

-- DropForeignKey
ALTER TABLE "contribution_metadata" DROP CONSTRAINT "contribution_metadata_periodId_fkey";

-- DropTable (its guard and allocation-sum triggers go with it)
DROP TABLE "contribution_metadata";
DROP FUNCTION trg_alloc_sum_from_metadata();

-- CreateIndex
CREATE INDEX "contribution_periodId_idx" ON "contribution"("periodId");

-- CreateIndex
CREATE INDEX "contribution_ridingNumber_entityKind_idx" ON "contribution"("ridingNumber", "entityKind");

-- AddForeignKey
ALTER TABLE "contribution" ADD CONSTRAINT "contribution_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "period"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- Invariant 5: contribution is now a guarded table (it carries the
-- descriptive fields the metadata table used to guard)
-- ===========================================================================

CREATE TRIGGER require_change_log_context_contribution
  BEFORE INSERT OR UPDATE OR DELETE ON contribution
  FOR EACH ROW EXECUTE FUNCTION require_change_log_context();

CREATE CONSTRAINT TRIGGER assert_change_log_written_contribution
  AFTER INSERT OR UPDATE ON contribution
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_change_log_written();
