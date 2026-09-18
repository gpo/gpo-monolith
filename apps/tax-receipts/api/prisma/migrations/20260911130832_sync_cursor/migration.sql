-- CreateTable
CREATE TABLE "sync_cursor" (
    "feedKind" TEXT NOT NULL,
    "since" TEXT,
    "token" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_cursor_pkey" PRIMARY KEY ("feedKind")
);
