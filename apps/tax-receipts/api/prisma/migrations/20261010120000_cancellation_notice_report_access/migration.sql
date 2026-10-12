-- Cancellation notice delivery and report access (EO evaluation rows 62 and 66).
--
-- 1. A cancelled receipt's watermarked notice can be emailed to the donor
--    through the outbox, as its own email purpose.
-- 2. Reading entity reports (list, detail, CSV) is no longer open to every
--    signed-in user: it needs the new `entityReport.read` permission, given
--    to the built-in roles that generate, share, or are sent reports.

-- AlterEnum
ALTER TYPE "EmailPurpose" ADD VALUE 'CANCELLATION';

-- ===========================================================================
-- Permission: view entity reports
-- ===========================================================================
-- Only where the built-in role still exists; an administrator may since have
-- changed its other permissions, which are left alone.
INSERT INTO "role_permission" ("roleKey", "permission")
SELECT "key", 'entityReport.read' FROM "role"
WHERE "key" IN ('party_cfo', 'bookkeeper', 'filer', 'organizer', 'cfo')
ON CONFLICT DO NOTHING;
