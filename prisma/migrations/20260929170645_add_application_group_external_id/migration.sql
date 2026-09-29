-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "groupExternalId" TEXT;

-- CreateIndex
CREATE INDEX "Application_providerId_groupExternalId_idx" ON "Application"("providerId", "groupExternalId");
