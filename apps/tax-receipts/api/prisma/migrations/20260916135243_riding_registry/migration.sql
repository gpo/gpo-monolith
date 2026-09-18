-- CreateTable
CREATE TABLE "riding" (
    "ridingNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "qomonApiKey" TEXT NOT NULL,
    "qomonApiBase" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "riding_pkey" PRIMARY KEY ("ridingNumber")
);
