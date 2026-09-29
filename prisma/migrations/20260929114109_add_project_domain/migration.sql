-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('APPLICATION', 'SERVICE', 'DATABASE');

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "resourceType" "ResourceType" NOT NULL DEFAULT 'APPLICATION';

-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN     "projectId" TEXT;

-- AlterTable
ALTER TABLE "UniverseEvent" ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "projectName" TEXT;

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "accent" TEXT NOT NULL DEFAULT '#38bdf8',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");

-- CreateIndex
CREATE INDEX "Application_projectId_idx" ON "Application"("projectId");

-- CreateIndex
CREATE INDEX "AuditEvent_projectId_idx" ON "AuditEvent"("projectId");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UniverseEvent" ADD CONSTRAINT "UniverseEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
