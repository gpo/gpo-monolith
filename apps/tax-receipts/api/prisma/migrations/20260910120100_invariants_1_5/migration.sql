-- Database invariants 1-5 (data-model.md §2, ticket 0.3). Enforced in the
-- database, not just the service layer. Invariants 6-8 are behavioural and
-- land with their phases.
--
-- 1. Per contribution: Σ allocation.amountCents over ISSUED receipts
--    ≤ amountCents − nonDeductibleCents  (the double-count guard, G1).
-- 2. A receipt total is derived from its allocations; a stored total is
--    forbidden. Enforced structurally: the `receipt` table has no total column.
-- 3. Receipt numbers strictly increase from ReceiptSequence; cancel/void
--    never free a number; no gaps at issuance time (G2).
-- 4. No hard delete on contribution, receipt, receipt_allocation,
--    change_log_entry.
-- 5. Every mutation of metadata, receipts, or allocations happens inside a
--    change-logged transaction (actor + reason + correlation id), and a
--    matching change_log_entry is written in the SAME transaction.
--
-- Note: Prisma maps table names to snake_case (@@map) but keeps column names
-- camelCase, so column identifiers below are quoted camelCase.

-- ===========================================================================
-- Invariant 5 plumbing: the transaction actor context
-- ===========================================================================
-- The api change-log write path (ticket 0.4) sets these tx-local settings
-- before any guarded mutation:
--   SELECT set_config('app.correlation_id', $1, true);
--   SELECT set_config('app.actor', $2, true);

CREATE OR REPLACE FUNCTION app_current_correlation_id() RETURNS text AS $$
  SELECT NULLIF(current_setting('app.correlation_id', true), '');
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION require_change_log_context() RETURNS trigger AS $$
BEGIN
  IF app_current_correlation_id() IS NULL THEN
    RAISE EXCEPTION
      'invariant 5: % on % must run inside a change-logged transaction (no app.correlation_id set)',
      TG_OP, TG_TABLE_NAME
      USING ERRCODE = 'raise_exception',
            HINT = 'use the api change-log write path (withChangeLog)';
  END IF;
  -- BEFORE trigger: must return the row (NULL would silently skip the write).
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION assert_change_log_written() RETURNS trigger AS $$
DECLARE
  v_cid text := app_current_correlation_id();
  v_count integer;
BEGIN
  IF v_cid IS NULL THEN
    RAISE EXCEPTION 'invariant 5: guarded mutation committed with no correlation id'
      USING ERRCODE = 'raise_exception';
  END IF;
  SELECT count(*) INTO v_count
  FROM change_log_entry
  WHERE "correlationId" = v_cid;
  IF v_count = 0 THEN
    RAISE EXCEPTION
      'invariant 5: transaction % mutated % but wrote no change_log_entry',
      v_cid, TG_TABLE_NAME
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ===========================================================================
-- Invariant 1: allocation sum ≤ eligible amount, over ISSUED receipts
-- ===========================================================================

CREATE OR REPLACE FUNCTION check_allocation_sum(p_contribution_id text) RETURNS void AS $$
DECLARE
  v_eligible integer;
  v_issued integer;
BEGIN
  SELECT c."amountCents" - COALESCE(m."nonDeductibleCents", 0)
    INTO v_eligible
  FROM contribution c
  LEFT JOIN contribution_metadata m ON m."contributionId" = c."id"
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

CREATE OR REPLACE FUNCTION trg_alloc_sum_from_allocation() RETURNS trigger AS $$
BEGIN
  PERFORM check_allocation_sum(COALESCE(NEW."contributionId", OLD."contributionId"));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_alloc_sum_from_receipt() RETURNS trigger AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT "contributionId" AS cid FROM receipt_allocation WHERE "receiptId" = NEW."id"
  LOOP
    PERFORM check_allocation_sum(r.cid);
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_alloc_sum_from_contribution() RETURNS trigger AS $$
BEGIN
  PERFORM check_allocation_sum(NEW."id");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_alloc_sum_from_metadata() RETURNS trigger AS $$
BEGIN
  PERFORM check_allocation_sum(NEW."contributionId");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Deferred so a multi-step correction (cancel old receipt, issue replacement)
-- is judged only at commit, never mid-cascade.
CREATE CONSTRAINT TRIGGER allocation_sum_on_allocation
  AFTER INSERT OR UPDATE ON receipt_allocation
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_alloc_sum_from_allocation();

CREATE CONSTRAINT TRIGGER allocation_sum_on_receipt
  AFTER UPDATE ON receipt
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_alloc_sum_from_receipt();

CREATE CONSTRAINT TRIGGER allocation_sum_on_contribution
  AFTER UPDATE ON contribution
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD."amountCents" IS DISTINCT FROM NEW."amountCents")
  EXECUTE FUNCTION trg_alloc_sum_from_contribution();

CREATE CONSTRAINT TRIGGER allocation_sum_on_metadata
  AFTER INSERT OR UPDATE ON contribution_metadata
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_alloc_sum_from_metadata();

-- ===========================================================================
-- Invariant 3: the sequence is sacred
-- ===========================================================================

CREATE OR REPLACE FUNCTION trg_sequence_monotonic() RETURNS trigger AS $$
BEGIN
  IF NEW."counter" < OLD."counter" THEN
    RAISE EXCEPTION 'invariant 3: receipt sequence "%" cannot go backward (% -> %)',
      OLD."prefix", OLD."counter", NEW."counter"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sequence_monotonic
  BEFORE UPDATE ON receipt_sequence
  FOR EACH ROW EXECUTE FUNCTION trg_sequence_monotonic();

-- A SEQUENCE-sourced receipt number must be a positive integer, must belong
-- to a known sequence, and must not exceed that sequence's counter (you
-- cannot issue ahead of the counter). FOREIGN numbers are exempt. The number
-- itself is immutable.
CREATE OR REPLACE FUNCTION trg_receipt_number_valid() RETURNS trigger AS $$
DECLARE
  v_prefix text;
  v_n bigint;
  v_counter integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."receiptNumber" IS DISTINCT FROM OLD."receiptNumber" THEN
    RAISE EXCEPTION 'invariant 3/G2: receiptNumber is immutable (% -> %)',
      OLD."receiptNumber", NEW."receiptNumber"
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."numberSource" <> 'SEQUENCE' THEN
    RETURN NEW;
  END IF;

  v_prefix := substring(NEW."receiptNumber" from '^([A-Za-z]+-)');
  v_n := substring(NEW."receiptNumber" from '(\d+)$')::bigint;

  IF v_prefix IS NULL OR v_n IS NULL OR v_n < 1 THEN
    RAISE EXCEPTION 'invariant 3: malformed SEQUENCE receipt number "%"', NEW."receiptNumber"
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT "counter" INTO v_counter FROM receipt_sequence WHERE "prefix" = v_prefix;
  IF v_counter IS NULL THEN
    RAISE EXCEPTION 'invariant 3: no receipt sequence for prefix "%"', v_prefix
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_n > v_counter THEN
    RAISE EXCEPTION
      'invariant 3: receipt % is ahead of sequence counter % (reserve the block first)',
      NEW."receiptNumber", v_counter
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER receipt_number_valid
  BEFORE INSERT OR UPDATE ON receipt
  FOR EACH ROW EXECUTE FUNCTION trg_receipt_number_valid();

-- ===========================================================================
-- Invariant 4: nothing is deleted
-- ===========================================================================

CREATE OR REPLACE FUNCTION trg_no_hard_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'invariant 4: rows in % are never hard-deleted (cancel/void instead)', TG_TABLE_NAME
    USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER no_hard_delete_contribution
  BEFORE DELETE ON contribution
  FOR EACH ROW EXECUTE FUNCTION trg_no_hard_delete();

CREATE TRIGGER no_hard_delete_receipt
  BEFORE DELETE ON receipt
  FOR EACH ROW EXECUTE FUNCTION trg_no_hard_delete();

CREATE TRIGGER no_hard_delete_receipt_allocation
  BEFORE DELETE ON receipt_allocation
  FOR EACH ROW EXECUTE FUNCTION trg_no_hard_delete();

-- ===========================================================================
-- Invariant 4/5: the change-log is append-only
-- ===========================================================================

CREATE OR REPLACE FUNCTION trg_change_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'change_log_entry is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER change_log_append_only
  BEFORE UPDATE OR DELETE ON change_log_entry
  FOR EACH ROW EXECUTE FUNCTION trg_change_log_append_only();

CREATE OR REPLACE FUNCTION trg_artifact_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'artifact records are immutable: % is not permitted', TG_OP
    USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER artifact_immutable
  BEFORE UPDATE OR DELETE ON artifact
  FOR EACH ROW EXECUTE FUNCTION trg_artifact_immutable();

-- ===========================================================================
-- Invariant 5: guarded tables require a change-logged transaction
-- ===========================================================================

CREATE TRIGGER require_change_log_context_metadata
  BEFORE INSERT OR UPDATE OR DELETE ON contribution_metadata
  FOR EACH ROW EXECUTE FUNCTION require_change_log_context();

CREATE TRIGGER require_change_log_context_receipt
  BEFORE INSERT OR UPDATE OR DELETE ON receipt
  FOR EACH ROW EXECUTE FUNCTION require_change_log_context();

CREATE TRIGGER require_change_log_context_allocation
  BEFORE INSERT OR UPDATE OR DELETE ON receipt_allocation
  FOR EACH ROW EXECUTE FUNCTION require_change_log_context();

CREATE CONSTRAINT TRIGGER assert_change_log_written_metadata
  AFTER INSERT OR UPDATE ON contribution_metadata
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_change_log_written();

CREATE CONSTRAINT TRIGGER assert_change_log_written_receipt
  AFTER INSERT OR UPDATE ON receipt
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_change_log_written();

CREATE CONSTRAINT TRIGGER assert_change_log_written_allocation
  AFTER INSERT OR UPDATE ON receipt_allocation
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_change_log_written();
