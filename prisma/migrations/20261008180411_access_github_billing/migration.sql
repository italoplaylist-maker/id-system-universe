-- CreateEnum
CREATE TYPE "GitHubInstallationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "DeploymentRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DeploymentTrigger" AS ENUM ('MANUAL', 'GITHUB_PUSH', 'GITHUB_MERGE');

-- CreateEnum
CREATE TYPE "RecurrencePeriod" AS ENUM ('WEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "RecurrenceStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReminderDirection" AS ENUM ('BEFORE', 'ON', 'AFTER');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "WhatsAppMessageStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "WhatsAppMessageKind" AS ENUM ('AUTOMATIC', 'MANUAL');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'SUPERADMIN';

-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN     "entityId" TEXT,
ADD COLUMN     "entityType" TEXT;

-- AlterTable
ALTER TABLE "UniverseEvent" ADD COLUMN     "permission" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "extraPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "ProjectAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConfig" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "secret" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConfig_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "GitHubInstallation" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "accountId" TEXT,
    "repositorySelection" TEXT,
    "status" "GitHubInstallationStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitHubRepository" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "ownerLogin" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultBranch" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubRepository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceRepository" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "githubRepositoryId" TEXT,
    "repositoryFullName" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "autoDeploy" BOOLEAN NOT NULL DEFAULT false,
    "onPush" BOOLEAN NOT NULL DEFAULT true,
    "onMerge" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceRepository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitHubWebhookDelivery" (
    "deliveryId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "action" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "GitHubWebhookDelivery_pkey" PRIMARY KEY ("deliveryId")
);

-- CreateTable
CREATE TABLE "DeploymentRun" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "projectId" TEXT,
    "repository" TEXT,
    "branch" TEXT,
    "commitSha" TEXT,
    "commitMessage" TEXT,
    "commitAuthor" TEXT,
    "commitUrl" TEXT,
    "triggerSource" "DeploymentTrigger" NOT NULL,
    "status" "DeploymentRunStatus" NOT NULL DEFAULT 'QUEUED',
    "deliveryId" TEXT,
    "coolifyDeploymentId" TEXT,
    "userId" TEXT,
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeploymentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tradeName" TEXT,
    "document" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientProject" (
    "clientId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "ClientProject_pkey" PRIMARY KEY ("clientId","projectId")
);

-- CreateTable
CREATE TABLE "BillingReason" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingRecurrence" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectId" TEXT,
    "reasonId" TEXT,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "period" "RecurrencePeriod" NOT NULL DEFAULT 'MONTHLY',
    "intervalDays" INTEGER,
    "dueDay" INTEGER,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "status" "RecurrenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "whatsappEnabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingRecurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Charge" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectId" TEXT,
    "recurrenceId" TEXT,
    "reasonId" TEXT,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "competence" TEXT,
    "status" "ChargeStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "whatsappEnabled" BOOLEAN NOT NULL DEFAULT true,
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargePayment" (
    "id" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "method" TEXT,
    "notes" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversedByUserId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChargePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeReminderRule" (
    "id" TEXT NOT NULL,
    "chargeId" TEXT,
    "recurrenceId" TEXT,
    "direction" "ReminderDirection" NOT NULL,
    "offsetDays" INTEGER NOT NULL DEFAULT 0,
    "sendTime" TEXT NOT NULL DEFAULT '09:00',
    "template" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChargeReminderRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeReminder" (
    "id" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "skippedReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChargeReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingTemplate" (
    "kind" "ReminderDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingTemplate_pkey" PRIMARY KEY ("kind")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "chargeId" TEXT,
    "reminderId" TEXT,
    "kind" "WhatsAppMessageKind" NOT NULL,
    "toPhone" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "WhatsAppMessageStatus" NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "error" TEXT,
    "createdByUserId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectAccess_projectId_idx" ON "ProjectAccess"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectAccess_userId_projectId_key" ON "ProjectAccess"("userId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubInstallation_installationId_key" ON "GitHubInstallation"("installationId");

-- CreateIndex
CREATE INDEX "GitHubRepository_fullName_idx" ON "GitHubRepository"("fullName");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubRepository_installationId_externalId_key" ON "GitHubRepository"("installationId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceRepository_applicationId_key" ON "ResourceRepository"("applicationId");

-- CreateIndex
CREATE INDEX "ResourceRepository_repositoryFullName_branch_idx" ON "ResourceRepository"("repositoryFullName", "branch");

-- CreateIndex
CREATE INDEX "DeploymentRun_applicationId_status_idx" ON "DeploymentRun"("applicationId", "status");

-- CreateIndex
CREATE INDEX "DeploymentRun_coolifyDeploymentId_idx" ON "DeploymentRun"("coolifyDeploymentId");

-- CreateIndex
CREATE INDEX "DeploymentRun_applicationId_finishedAt_idx" ON "DeploymentRun"("applicationId", "finishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentRun_applicationId_repository_branch_commitSha_key" ON "DeploymentRun"("applicationId", "repository", "branch", "commitSha");

-- CreateIndex
CREATE INDEX "Client_name_idx" ON "Client"("name");

-- CreateIndex
CREATE INDEX "ClientProject_projectId_idx" ON "ClientProject"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingReason_name_key" ON "BillingReason"("name");

-- CreateIndex
CREATE INDEX "BillingRecurrence_status_idx" ON "BillingRecurrence"("status");

-- CreateIndex
CREATE INDEX "BillingRecurrence_clientId_idx" ON "BillingRecurrence"("clientId");

-- CreateIndex
CREATE INDEX "Charge_dueDate_status_idx" ON "Charge"("dueDate", "status");

-- CreateIndex
CREATE INDEX "Charge_clientId_idx" ON "Charge"("clientId");

-- CreateIndex
CREATE INDEX "Charge_projectId_idx" ON "Charge"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_recurrenceId_competence_key" ON "Charge"("recurrenceId", "competence");

-- CreateIndex
CREATE INDEX "ChargePayment_chargeId_idx" ON "ChargePayment"("chargeId");

-- CreateIndex
CREATE INDEX "ChargeReminderRule_chargeId_idx" ON "ChargeReminderRule"("chargeId");

-- CreateIndex
CREATE INDEX "ChargeReminderRule_recurrenceId_idx" ON "ChargeReminderRule"("recurrenceId");

-- CreateIndex
CREATE INDEX "ChargeReminder_status_scheduledAt_idx" ON "ChargeReminder"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeReminder_chargeId_ruleId_scheduledAt_key" ON "ChargeReminder"("chargeId", "ruleId", "scheduledAt");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_chargeId_idx" ON "WhatsAppMessage"("chargeId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_clientId_idx" ON "WhatsAppMessage"("clientId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "ProjectAccess" ADD CONSTRAINT "ProjectAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAccess" ADD CONSTRAINT "ProjectAccess_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubRepository" ADD CONSTRAINT "GitHubRepository_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "GitHubInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceRepository" ADD CONSTRAINT "ResourceRepository_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceRepository" ADD CONSTRAINT "ResourceRepository_githubRepositoryId_fkey" FOREIGN KEY ("githubRepositoryId") REFERENCES "GitHubRepository"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentRun" ADD CONSTRAINT "DeploymentRun_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentRun" ADD CONSTRAINT "DeploymentRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProject" ADD CONSTRAINT "ClientProject_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProject" ADD CONSTRAINT "ClientProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingRecurrence" ADD CONSTRAINT "BillingRecurrence_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingRecurrence" ADD CONSTRAINT "BillingRecurrence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingRecurrence" ADD CONSTRAINT "BillingRecurrence_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "BillingReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "BillingRecurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "BillingReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargePayment" ADD CONSTRAINT "ChargePayment_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeReminderRule" ADD CONSTRAINT "ChargeReminderRule_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeReminderRule" ADD CONSTRAINT "ChargeReminderRule_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "BillingRecurrence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeReminder" ADD CONSTRAINT "ChargeReminder_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeReminder" ADD CONSTRAINT "ChargeReminder_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ChargeReminderRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE SET NULL ON UPDATE CASCADE;
