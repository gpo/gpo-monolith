-- Merge duplicate contacts (corrections.md action 10). A merge never deletes a
-- contact: the merged-away record stays, pointing at the survivor, so the
-- merge can be reviewed and reversed with its audit trail.

ALTER TABLE "contact" ADD COLUMN "mergedIntoId" TEXT;
ALTER TABLE "contact" ADD COLUMN "mergedAt" TIMESTAMP(3);

CREATE INDEX "contact_mergedIntoId_idx" ON "contact"("mergedIntoId");

ALTER TABLE "contact" ADD CONSTRAINT "contact_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "contact" ADD CONSTRAINT "contact_not_merged_into_self" CHECK ("mergedIntoId" IS NULL OR "mergedIntoId" <> "id");
