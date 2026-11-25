CREATE TYPE "SweepRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'SUCCEEDED_WITH_WARNINGS', 'FAILED');
CREATE TABLE "sweep_run" (
  "id" UUID NOT NULL,
  "status" "SweepRunStatus" NOT NULL DEFAULT 'QUEUED',
  "mode" TEXT NOT NULL DEFAULT 'incremental' CHECK ("mode" IN ('incremental', 'full')),
  "target" TEXT NOT NULL DEFAULT 'party' CHECK ("target" = 'party'),
  "triggerSource" TEXT NOT NULL DEFAULT 'MANUAL' CHECK ("triggerSource" = 'MANUAL'),
  "requestedByUserId" TEXT NOT NULL REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "result" JSONB,
  "error" TEXT,
  CONSTRAINT "sweep_run_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sweep_run_createdAt_id_idx" ON "sweep_run"("createdAt", "id");
