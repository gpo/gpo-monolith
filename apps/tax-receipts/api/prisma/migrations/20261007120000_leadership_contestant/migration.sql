-- Leadership contestants (EO evaluation row 25): a contribution can be
-- directed to a leadership contestant (EO political entity type LC) as well
-- as the party, a constituency association, or a campaign.
--
-- 1. A LEADERSHIP entity kind. Like PARTY it carries no riding.
-- 2. A leadership_contestant registry, managed under Admin and change-logged
--    under the new LeadershipContestant subject type.
-- 3. contribution.leadershipContestantId names the contestant.

-- AlterEnum
ALTER TYPE "EntityKind" ADD VALUE 'LEADERSHIP';

-- AlterEnum
ALTER TYPE "ChangeLogSubjectType" ADD VALUE 'LeadershipContestant';

-- CreateTable
CREATE TABLE "leadership_contestant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contestName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leadership_contestant_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "contribution" ADD COLUMN "leadershipContestantId" TEXT;

-- CreateIndex
CREATE INDEX "contribution_leadershipContestantId_idx" ON "contribution"("leadershipContestantId");

-- AddForeignKey
ALTER TABLE "contribution" ADD CONSTRAINT "contribution_leadershipContestantId_fkey" FOREIGN KEY ("leadershipContestantId") REFERENCES "leadership_contestant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- Invariant 5: leadership_contestant is a guarded table, and (invariant 4)
-- a contestant is never hard-deleted; one who withdraws is made inactive
-- ===========================================================================

CREATE TRIGGER require_change_log_context_leadership_contestant
  BEFORE INSERT OR UPDATE OR DELETE ON leadership_contestant
  FOR EACH ROW EXECUTE FUNCTION require_change_log_context();

CREATE CONSTRAINT TRIGGER assert_change_log_written_leadership_contestant
  AFTER INSERT OR UPDATE ON leadership_contestant
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_change_log_written();

CREATE TRIGGER no_hard_delete_leadership_contestant
  BEFORE DELETE ON leadership_contestant
  FOR EACH ROW EXECUTE FUNCTION trg_no_hard_delete();
