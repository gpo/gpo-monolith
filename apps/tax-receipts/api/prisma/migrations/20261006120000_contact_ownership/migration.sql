-- Contact ownership and audit (D13; EO evaluation rows 19 to 23).
--
-- 1. Contributors can be added and edited in the tool. With no Qomon space
--    configured a contact is tool-owned; with one, the tool writes to Qomon
--    first and mirrors the result. Either way the local write is audited.
-- 2. contact becomes a guarded table (invariant 5): every insert or update
--    must run inside a change-logged transaction, whichever path made it
--    (the in-tool form, the Qomon import sweep, a refresh, a merge, a seed).
-- 3. A recorded contributor type (Individual only, row 23).
-- 4. The new `contact.manage` permission, given to the built-in roles that
--    enter payments.

-- CreateEnum
CREATE TYPE "ContributorType" AS ENUM ('INDIVIDUAL');

-- AlterTable
ALTER TABLE "contact" ADD COLUMN "contributorType" "ContributorType" NOT NULL DEFAULT 'INDIVIDUAL';

-- ===========================================================================
-- Invariant 5: contact is a guarded table
-- ===========================================================================

CREATE TRIGGER require_change_log_context_contact
  BEFORE INSERT OR UPDATE OR DELETE ON contact
  FOR EACH ROW EXECUTE FUNCTION require_change_log_context();

CREATE CONSTRAINT TRIGGER assert_change_log_written_contact
  AFTER INSERT OR UPDATE ON contact
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_change_log_written();

-- Invariant 4: a contributor is never hard-deleted (a duplicate is merged)
CREATE TRIGGER no_hard_delete_contact
  BEFORE DELETE ON contact
  FOR EACH ROW EXECUTE FUNCTION trg_no_hard_delete();

-- ===========================================================================
-- Permission: add and edit contributors
-- ===========================================================================
-- Only where the built-in role still exists; an administrator may since have
-- changed its other permissions, which are left alone.
INSERT INTO "role_permission" ("roleKey", "permission")
SELECT "key", 'contact.manage' FROM "role" WHERE "key" IN ('party_cfo', 'administrator')
ON CONFLICT DO NOTHING;
