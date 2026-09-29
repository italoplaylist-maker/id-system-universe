-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('COOLIFY', 'DOCKER', 'VERCEL', 'RAILWAY', 'RENDER', 'KUBERNETES');

-- CreateEnum
CREATE TYPE "ProviderHealth" AS ENUM ('ONLINE', 'DEGRADED', 'OFFLINE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('RUNNING', 'STOPPED', 'DEPLOYING', 'ERROR', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ViewMode" AS ENUM ('UNIVERSE', 'LIST');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'ADMIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reducedGraphics" BOOLEAN NOT NULL DEFAULT false,
    "defaultView" "ViewMode" NOT NULL DEFAULT 'UNIVERSE',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InfrastructureProvider" (
    "id" TEXT NOT NULL,
    "type" "ProviderType" NOT NULL DEFAULT 'COOLIFY',
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "color" TEXT NOT NULL DEFAULT '#38bdf8',
    "metadata" JSONB,
    "health" "ProviderHealth" NOT NULL DEFAULT 'UNKNOWN',
    "latencyMs" INTEGER,
    "lastCheckAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InfrastructureProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'UNKNOWN',
    "fqdn" TEXT,
    "repository" TEXT,
    "branch" TEXT,
    "lastDeployedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pendingOperation" TEXT,
    "pendingSince" TIMESTAMP(3),
    "pendingDeploymentExternalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeploymentCache" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "commit" TEXT,
    "commitMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeploymentCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "providerId" TEXT,
    "applicationId" TEXT,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UniverseEvent" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT,
    "applicationName" TEXT,
    "providerId" TEXT,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UniverseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");

-- CreateIndex
CREATE INDEX "Application_providerId_idx" ON "Application"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_providerId_externalId_key" ON "Application"("providerId", "externalId");

-- CreateIndex
CREATE INDEX "DeploymentCache_applicationId_idx" ON "DeploymentCache"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentCache_applicationId_externalId_key" ON "DeploymentCache"("applicationId", "externalId");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_applicationId_idx" ON "AuditEvent"("applicationId");

-- CreateIndex
CREATE INDEX "UniverseEvent_createdAt_idx" ON "UniverseEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "InfrastructureProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentCache" ADD CONSTRAINT "DeploymentCache_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "InfrastructureProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UniverseEvent" ADD CONSTRAINT "UniverseEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UniverseEvent" ADD CONSTRAINT "UniverseEvent_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "InfrastructureProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
