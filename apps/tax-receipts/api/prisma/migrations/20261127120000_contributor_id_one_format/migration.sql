-- One contributor id format for EO (gpo/gpo-monolith#170).
--
-- Until now a contact's contributor id was its Qomon contact id when it had
-- one, and `T` plus a sequence number otherwise. EO staff read those as two
-- unrelated id schemes. Qomon is no longer the source of contact identity
-- (D10), so the tool now numbers every contributor itself:
--
-- 1. Every new contact gets a plain number from contact_contributor_id_seq,
--    whether or not it is linked to Qomon. The Qomon contact id stays on the
--    contact as `qomonContactId`, an external reference only.
-- 2. Generated numbers start at 10,000,000. Everything below that is
--    reserved for the CiviCRM contact ids EO already holds: the historical
--    CiviCRM import inserts contacts with an explicit contributorId (their
--    CiviCRM id), and the two ranges can never collide.
-- 3. A check constraint keeps every id a plain positive number of at most
--    10 digits (EO allows 10 alphanumeric characters).
-- 4. Existing contacts are renumbered once, in creation order, in a
--    change-logged transaction (contact is a guarded table, invariant 5).
--    The tool has not filed with EO yet (cutover is January 2027), so no
--    filed id changes. The immutability trigger is lifted for this one
--    statement only.

-- The Qomon id no longer becomes the contributor id
DROP TRIGGER assign_contributor_id_contact ON contact;
DROP FUNCTION assign_contact_contributor_id();

ALTER SEQUENCE "contact_contributor_id_seq"
  START WITH 10000000 MINVALUE 10000000 MAXVALUE 9999999999 NO CYCLE
  RESTART WITH 10000000;

ALTER TABLE "contact"
  ALTER COLUMN "contributorId"
  SET DEFAULT (nextval('contact_contributor_id_seq'::regclass)::text);

-- ===========================================================================
-- Renumber existing contacts
-- ===========================================================================

ALTER TABLE contact DISABLE TRIGGER no_contributor_id_change_contact;

DO $$
DECLARE
  v_reason constant text :=
    'One contributor id format for EO (#170): every contributor gets a tool-assigned number';
  v_cid constant text := 'migration-20261127120000-contributor-id-one-format';
BEGIN
  PERFORM set_config('app.correlation_id', v_cid, true);
  PERFORM set_config('app.actor', 'system', true);

  CREATE TEMP TABLE contributor_id_renumber ON COMMIT DROP AS
  SELECT s.id, s."contributorId" AS old_id,
         nextval('contact_contributor_id_seq'::regclass)::text AS new_id
  FROM (SELECT id, "contributorId" FROM contact ORDER BY "createdAt", id) s;

  INSERT INTO change_log_entry ("id", "subjectType", "subjectId", "actorUserId", "reason", "before", "after", "correlationId")
  SELECT gen_random_uuid()::text, 'Contact'::"ChangeLogSubjectType", r.id, NULL, v_reason,
         jsonb_build_object('contributorId', r.old_id),
         jsonb_build_object('contributorId', r.new_id),
         v_cid
  FROM contributor_id_renumber r;

  -- Two passes: an old id (a Qomon contact id) may equal another contact's
  -- new id, and the unique index is checked row by row
  UPDATE contact c SET "contributorId" = 'x' || r.new_id
  FROM contributor_id_renumber r WHERE r.id = c.id;

  UPDATE contact SET "contributorId" = substr("contributorId", 2);
END;
$$;

-- Run the deferred invariant 5 checks now: ALTER TABLE refuses a table with
-- pending trigger events
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE contact ENABLE TRIGGER no_contributor_id_change_contact;

ALTER TABLE "contact"
  ADD CONSTRAINT "contact_contributorId_numeric"
  CHECK ("contributorId" ~ '^[1-9][0-9]{0,9}$');
