-- Role table (EO evaluation rows 7 and 8). Roles were a fixed enum
-- ("UserRole") whose permissions were a switch in auth/abilities.ts. They
-- become rows an administrator can create and edit, each with a list of
-- permission keys from the catalogue in auth/permissions.ts.
--
-- The ten enum values are seeded as built-in roles with the permissions
-- that reproduce the old switch (BUILT_IN_ROLES), and every user keeps the
-- role they held: app_user.role (enum) becomes app_user."roleKey" (FK).

-- AlterEnum
ALTER TYPE "ChangeLogSubjectType" ADD VALUE 'Role';

-- CreateTable
CREATE TABLE "role" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "builtIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "roleKey" TEXT NOT NULL,
    "permission" TEXT NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("roleKey","permission")
);

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_roleKey_fkey" FOREIGN KEY ("roleKey") REFERENCES "role"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the built-in roles (generated from BUILT_IN_ROLES)
INSERT INTO "role" ("key", "name", "description", "builtIn", "updatedAt") VALUES
    ('sysadmin', 'System administrator', 'Full configuration and user administration.', true, CURRENT_TIMESTAMP),
    ('party_cfo', 'Party CFO', 'The only role that may issue receipts (EFA s. 25.1(6)); files with EO.', true, CURRENT_TIMESTAMP),
    ('administrator', 'Receipt administrator', 'Day-to-day contribution and receipt work.', true, CURRENT_TIMESTAMP),
    ('rules_authority', 'Rules authority', 'Eligibility calls, moves between entities, and non-deductible amounts.', true, CURRENT_TIMESTAMP),
    ('bookkeeper', 'Bookkeeper', 'Reconciliation, S2P2, and auditor liaison.', true, CURRENT_TIMESTAMP),
    ('filer', 'Filer', 'Prepares and submits reports and forms to EO.', true, CURRENT_TIMESTAMP),
    ('process_owner', 'Process owner', 'Oversight: reads everything, including who has done what.', true, CURRENT_TIMESTAMP),
    ('organizer', 'Organizer', 'Liaison with riding association and campaign CFOs.', true, CURRENT_TIMESTAMP),
    ('cfo', 'Riding or campaign CFO', 'External CFO: reads only their granted riding(s).', true, CURRENT_TIMESTAMP),
    ('readonly', 'Read only', 'Reads the operational screens; changes nothing.', true, CURRENT_TIMESTAMP);

INSERT INTO "role_permission" ("roleKey", "permission") VALUES
    ('sysadmin', 'system.manage'),
    ('party_cfo', 'records.readAll'),
    ('party_cfo', 'payment.enter'),
    ('party_cfo', 'contribution.edit'),
    ('party_cfo', 'contribution.correct'),
    ('party_cfo', 'receipt.issue'),
    ('party_cfo', 'receipt.correct'),
    ('party_cfo', 'killSwitch.administer'),
    ('party_cfo', 'entityReport.generate'),
    ('party_cfo', 'entityReport.share'),
    ('party_cfo', 'filing.submit'),
    ('administrator', 'payment.enter'),
    ('administrator', 'contribution.edit'),
    ('administrator', 'contribution.correct'),
    ('administrator', 'workItem.create'),
    ('administrator', 'workItem.resolve'),
    ('administrator', 'receipt.correct'),
    ('rules_authority', 'contribution.edit'),
    ('rules_authority', 'contribution.correct'),
    ('rules_authority', 'workItem.resolve'),
    ('bookkeeper', 'records.readAll'),
    ('bookkeeper', 'reconciliation.manage'),
    ('bookkeeper', 'entityReport.generate'),
    ('bookkeeper', 'workItem.resolve'),
    ('filer', 'records.readAll'),
    ('filer', 'filing.prepare'),
    ('filer', 'filing.submit'),
    ('filer', 'entityReport.generate'),
    ('filer', 'entityReport.share'),
    ('filer', 'workItem.resolve'),
    ('process_owner', 'records.readAll'),
    ('organizer', 'entityReport.share');

-- Move each user onto the role row matching their enum value
ALTER TABLE "app_user" ADD COLUMN "roleKey" TEXT NOT NULL DEFAULT 'readonly';
UPDATE "app_user" SET "roleKey" = "role"::text;
ALTER TABLE "app_user" DROP COLUMN "role";

-- DropEnum
DROP TYPE "UserRole";

-- CreateIndex
CREATE INDEX "app_user_roleKey_idx" ON "app_user"("roleKey");

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_roleKey_fkey" FOREIGN KEY ("roleKey") REFERENCES "role"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
