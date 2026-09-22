-- Invariant 7 (data-model.md §2, ticket 3.3): an AddressSnapshot referenced
-- by a receipt is immutable, and a receipt's own core facts never change
-- after issuance -- corrections.md's principle 1: "A receipt record, once
-- generated, never changes; corrections produce new records." Invariants
-- 1-5 shipped with ticket 0.3; invariant 3's receiptNumber clause already
-- covers one field of this (trg_receipt_number_valid, migration
-- 20260910120100). This migration covers everything invariant 3 didn't:
-- every other identity field on `receipt`, plus `address_snapshot`.
--
-- What stays mutable, and why: `status` (ISSUED -> CANCELLED/VOID only, per
-- the receipt lifecycle in corrections.md; terminal once cancelled/void),
-- `lost` (one-way false -> true; no "un-lose" action exists anywhere in the
-- spec), `replacedById` (one-time NULL -> value: a later reissue points
-- back at the receipt it replaces), `pdfArtifactId` (one-time NULL -> value:
-- ticket 3.1's issuance flow sets this in a second write right after
-- creating the row), and `delivery`/`deliveredAt` (delivery logistics, not
-- a receipt fact this invariant is about -- tickets 3.5/3.6 haven't
-- specified their lifecycle yet, so left unconstrained rather than guessed
-- at).

-- ===========================================================================
-- AddressSnapshot: immutable once any receipt references it
-- ===========================================================================
-- `Receipt.addressSnapshotId` never changes after creation (enforced below),
-- so "referenced" is a permanent fact once a receipt exists -- no need to
-- distinguish an ISSUED receipt from a later-cancelled one; the snapshot
-- that was actually printed must stay exactly as printed either way.

CREATE OR REPLACE FUNCTION trg_address_snapshot_immutable() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM receipt WHERE "addressSnapshotId" = OLD."id") THEN
    RAISE EXCEPTION 'invariant 7: address_snapshot % is referenced by a receipt and is immutable (%)',
      OLD."id", TG_OP
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- No hard-delete trigger existed for address_snapshot before this migration
-- (0.3's invariant-4 list covered contribution/receipt/receipt_allocation/
-- change_log_entry only) -- a real gap, closed here rather than carried
-- forward: an unreferenced snapshot deleting was never a case anything
-- does, but nothing stopped it either.
CREATE TRIGGER address_snapshot_immutable_on_update
  BEFORE UPDATE ON address_snapshot
  FOR EACH ROW EXECUTE FUNCTION trg_address_snapshot_immutable();

CREATE TRIGGER address_snapshot_immutable_on_delete
  BEFORE DELETE ON address_snapshot
  FOR EACH ROW EXECUTE FUNCTION trg_address_snapshot_immutable();

-- ===========================================================================
-- Receipt: core identity fields frozen after issuance; a narrow, named set
-- of fields may still move through their own one-way transitions.
-- ===========================================================================

CREATE OR REPLACE FUNCTION trg_receipt_immutable_fields() RETURNS trigger AS $$
BEGIN
  IF NEW."numberSource" IS DISTINCT FROM OLD."numberSource"
    OR NEW."ridingNumber" IS DISTINCT FROM OLD."ridingNumber"
    OR NEW."entityKind" IS DISTINCT FROM OLD."entityKind"
    OR NEW."periodId" IS DISTINCT FROM OLD."periodId"
    OR NEW."issueDate" IS DISTINCT FROM OLD."issueDate"
    OR NEW."contactId" IS DISTINCT FROM OLD."contactId"
    OR NEW."contactNameSnapshot" IS DISTINCT FROM OLD."contactNameSnapshot"
    OR NEW."addressSnapshotId" IS DISTINCT FROM OLD."addressSnapshotId"
    OR NEW."reissuedFromId" IS DISTINCT FROM OLD."reissuedFromId"
  THEN
    RAISE EXCEPTION 'invariant 7: receipt % core fields are immutable once issued', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" AND OLD."status" <> 'ISSUED' THEN
    RAISE EXCEPTION 'invariant 7: receipt % status % is terminal', OLD."id", OLD."status"
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."lost" = true AND NEW."lost" = false THEN
    RAISE EXCEPTION 'invariant 7: receipt % cannot be un-flagged lost', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."replacedById" IS NOT NULL AND NEW."replacedById" IS DISTINCT FROM OLD."replacedById" THEN
    RAISE EXCEPTION 'invariant 7: receipt % replacedById is already set', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."pdfArtifactId" IS NOT NULL AND NEW."pdfArtifactId" IS DISTINCT FROM OLD."pdfArtifactId" THEN
    RAISE EXCEPTION 'invariant 7: receipt % pdfArtifactId is already set', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER receipt_immutable_fields
  BEFORE UPDATE ON receipt
  FOR EACH ROW EXECUTE FUNCTION trg_receipt_immutable_fields();
