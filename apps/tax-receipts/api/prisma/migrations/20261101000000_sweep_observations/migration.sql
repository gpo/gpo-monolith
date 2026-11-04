ALTER TABLE "qomon_transaction_link" ADD COLUMN "feedKind" TEXT NOT NULL DEFAULT 'qomon-poll', ADD COLUMN "observedRun" TEXT;
