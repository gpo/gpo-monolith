-- The contributor id EO filings carry (open-questions.md O38). EO's spec
-- makes `Contributor ID` mandatory for GPO on RTD, ALL, and S2P2: the
-- contributor's unique id in the party database, alphanumeric, at most 10
-- characters (eo-reporting.md §1).
--
-- 1. The id belongs to the contributor, so it moves from a per-contribution
--    column nothing populated (`contribution.eoContributorId`) to
--    `contact.contributorId`, assigned at insert and never changed:
--      - a Qomon-backed contact: its Qomon contact id;
--      - a tool-owned contact (no Qomon configured, or a fixture): `T` plus
--        a sequence number, which can never collide with a numeric Qomon id.
-- 2. Existing contacts are backfilled the same way, in a change-logged
--    transaction (contact is a guarded table, invariant 5).
-- 3. Any `contribution.eoContributorId` an operator did set is recorded in
--    the change log before the column is dropped, so no value is lost
--    without a trace.

CREATE SEQUENCE "contact_contributor_id_seq";

-- AlterTable: the default numbers every existing row; ALTER TABLE fires no
-- row triggers, so this needs no change-log context
ALTER TABLE "contact"
  ADD COLUMN "contributorId" VARCHAR(10) NOT NULL
  DEFAULT ('T'::text || nextval('contact_contributor_id_seq'::regclass));

CREATE UNIQUE INDEX "contact_contributorId_key" ON "contact"("contributorId");

-- ===========================================================================
-- Assignment at insert, and immutability after
-- ===========================================================================

CREATE OR REPLACE FUNCTION assign_contact_contributor_id() RETURNS trigger AS $$
BEGIN
  IF NEW."qomonContactId" IS NOT NULL THEN
    IF length(NEW."qomonContactId"::text) > 10 THEN
      RAISE EXCEPTION
        'Qomon contact id % is longer than the 10 characters EO allows for a contributor id',
        NEW."qomonContactId"
        USING ERRCODE = 'raise_exception';
    END IF;
    NEW."contributorId" := NEW."qomonContactId"::text;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER assign_contributor_id_contact
  BEFORE INSERT ON contact
  FOR EACH ROW EXECUTE FUNCTION assign_contact_contributor_id();

CREATE OR REPLACE FUNCTION no_contributor_id_change() RETURNS trigger AS $$
BEGIN
  IF NEW."contributorId" IS DISTINCT FROM OLD."contributorId" THEN
    RAISE EXCEPTION
      'contact %: a contributor id is never changed once assigned (% to %)',
      OLD.id, OLD."contributorId", NEW."contributorId"
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===========================================================================
-- Backfill (one statement, so one transaction: the deferred invariant 5
-- check sees the change-log entries written alongside the updates)
-- ===========================================================================

DO $$
DECLARE
  v_reason constant text :=
    'Assign the EO contributor id (O38): the Qomon contact id where there is one, a tool sequence otherwise';
  v_cid constant text := 'migration-20261012120000-contact-contributor-id';
BEGIN
  PERFORM set_config('app.correlation_id', v_cid, true);
  PERFORM set_config('app.actor', 'system', true);

  IF EXISTS (SELECT 1 FROM contact WHERE length("qomonContactId"::text) > 10) THEN
    RAISE EXCEPTION 'a Qomon contact id is longer than the 10 characters EO allows for a contributor id';
  END IF;

  INSERT INTO change_log_entry ("id", "subjectType", "subjectId", "actorUserId", "reason", "before", "after", "correlationId")
  SELECT gen_random_uuid()::text, 'Contact'::"ChangeLogSubjectType", c.id, NULL, v_reason,
         jsonb_build_object('contributorId', NULL),
         jsonb_build_object('contributorId', COALESCE(c."qomonContactId"::text, c."contributorId")),
         v_cid
  FROM contact c;

  UPDATE contact SET "contributorId" = "qomonContactId"::text WHERE "qomonContactId" IS NOT NULL;

  INSERT INTO change_log_entry ("id", "subjectType", "subjectId", "actorUserId", "reason", "before", "after", "correlationId")
  SELECT gen_random_uuid()::text, 'Contribution'::"ChangeLogSubjectType", k.id, NULL,
         'Contributor id moves from the contribution to its contact (O38); this value was set here and is not carried over',
         jsonb_build_object('eoContributorId', k."eoContributorId"),
         jsonb_build_object('eoContributorId', NULL),
         v_cid
  FROM contribution k
  WHERE k."eoContributorId" IS NOT NULL;
END;
$$;

CREATE TRIGGER no_contributor_id_change_contact
  BEFORE UPDATE ON contact
  FOR EACH ROW EXECUTE FUNCTION no_contributor_id_change();

-- AlterTable
ALTER TABLE "contribution" DROP COLUMN "eoContributorId";
