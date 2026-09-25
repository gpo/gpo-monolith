-- Contribution corrections (corrections.md, D12): the database side of the
-- versioned-contribution lifecycle.
--
--  1. A contribution that any receipt allocation or RTD inclusion references
--     never changes its material facts; a correction supersedes it with new
--     rows instead (corrections.md principle 1).
--  2. A SUPERSEDED or REFUNDED row is history: frozen entirely.
--  3. A SUPERSEDED row must have at least one replacement (checked at commit,
--     so a correction can insert the replacements and flip the old row in
--     either order).
--  4. One cancelled receipt may be replaced by several (a split), so
--     receipt.reissuedFromId stops being unique. receipt.replacedById stays
--     unique and names the primary replacement.
--  5. entity_report.filedAt records that a report went into a filed return,
--     the trigger for the "current-year return note" cascade step.

-- ===========================================================================
-- 1 + 2. Contribution immutability
-- ===========================================================================

CREATE OR REPLACE FUNCTION trg_contribution_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'ACTIVE' THEN
    RAISE EXCEPTION 'contribution % is % and is history; correct the row that replaced it', OLD."id", OLD."status"
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."supersedesId" IS DISTINCT FROM OLD."supersedesId" THEN
    RAISE EXCEPTION 'contribution % supersedesId is fixed at creation', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;

  IF (
    NEW."paymentId" IS DISTINCT FROM OLD."paymentId"
    OR NEW."contactId" IS DISTINCT FROM OLD."contactId"
    OR NEW."amountCents" IS DISTINCT FROM OLD."amountCents"
    OR NEW."acceptedAt" IS DISTINCT FROM OLD."acceptedAt"
    OR NEW."periodId" IS DISTINCT FROM OLD."periodId"
    OR NEW."ridingNumber" IS DISTINCT FROM OLD."ridingNumber"
    OR NEW."entityKind" IS DISTINCT FROM OLD."entityKind"
    OR NEW."goodsServices" IS DISTINCT FROM OLD."goodsServices"
    OR NEW."nonDeductibleCents" IS DISTINCT FROM OLD."nonDeductibleCents"
  ) AND (
    EXISTS (SELECT 1 FROM receipt_allocation WHERE "contributionId" = OLD."id")
    OR EXISTS (SELECT 1 FROM rtd_inclusion WHERE "contributionId" = OLD."id")
  ) THEN
    RAISE EXCEPTION 'contribution % backs a receipt or an RTD filing; its material fields change only by superseding it', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contribution_immutable
  BEFORE UPDATE ON contribution
  FOR EACH ROW EXECUTE FUNCTION trg_contribution_immutable();

-- ===========================================================================
-- 3. A superseded contribution has a replacement
-- ===========================================================================

CREATE OR REPLACE FUNCTION trg_contribution_superseded_has_successor() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'SUPERSEDED'
    AND NOT EXISTS (SELECT 1 FROM contribution WHERE "supersedesId" = NEW."id")
  THEN
    RAISE EXCEPTION 'contribution % is SUPERSEDED but nothing replaces it', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER contribution_superseded_has_successor
  AFTER INSERT OR UPDATE ON contribution
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_contribution_superseded_has_successor();

-- ===========================================================================
-- 4. A split reissues one receipt as several
-- ===========================================================================

DROP INDEX "receipt_reissuedFromId_key";
CREATE INDEX "receipt_reissuedFromId_idx" ON "receipt"("reissuedFromId");

-- ===========================================================================
-- 5. Filed entity reports
-- ===========================================================================

ALTER TABLE "entity_report" ADD COLUMN "filedAt" TIMESTAMP(3);
