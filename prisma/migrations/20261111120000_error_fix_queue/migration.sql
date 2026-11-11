-- AlterTable
ALTER TABLE "ErrorGroup" ADD COLUMN "fixTaskId" TEXT,
ADD COLUMN "fixSentAt" TIMESTAMP(3),
ADD COLUMN "dismissedAt" TIMESTAMP(3);
