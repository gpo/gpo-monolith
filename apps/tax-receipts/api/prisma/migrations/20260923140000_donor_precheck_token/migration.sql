-- AlterTable
ALTER TABLE "donor_cycle_preference" ADD COLUMN     "confirmationToken" TEXT,
ADD COLUMN     "confirmationTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "confirmationPeriodId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "donor_cycle_preference_confirmationToken_key" ON "donor_cycle_preference"("confirmationToken");

-- AddForeignKey
ALTER TABLE "donor_cycle_preference" ADD CONSTRAINT "donor_cycle_preference_confirmationPeriodId_fkey" FOREIGN KEY ("confirmationPeriodId") REFERENCES "period"("id") ON DELETE SET NULL ON UPDATE CASCADE;
