-- AlterTable
ALTER TABLE "DeploymentCache" ADD COLUMN     "logs" TEXT,
ADD COLUMN     "logsSavedAt" TIMESTAMP(3);
