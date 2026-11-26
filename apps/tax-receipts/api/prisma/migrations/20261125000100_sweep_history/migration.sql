ALTER TYPE "SweepRunStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "SweepRunStatus" ADD VALUE 'SKIPPED';
ALTER TABLE sweep_run
  ADD COLUMN "ridingNumber" INTEGER,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "durationMs" INTEGER;
ALTER TABLE sweep_run DROP CONSTRAINT sweep_run_target_check;
ALTER TABLE sweep_run ADD CONSTRAINT sweep_run_target_check CHECK (
  (target = 'party' AND "ridingNumber" IS NULL) OR
  (target = 'riding' AND "ridingNumber" IS NOT NULL AND "ridingNumber" > 0)
);
