-- CreateTable
CREATE TABLE "AgentProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specialty" TEXT,
    "cwd" TEXT NOT NULL,
    "projectId" TEXT,
    "model" TEXT,
    "permissionMode" TEXT NOT NULL DEFAULT 'default',
    "claudeSessionId" TEXT,
    "lastError" TEXT,
    "lastActiveAt" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTask" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "result" TEXT,
    "error" TEXT,
    "claudeSessionId" TEXT,
    "costUsd" DOUBLE PRECISION,
    "turns" INTEGER,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "nextSeq" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTaskEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "tool" TEXT,
    "text" TEXT,

    CONSTRAINT "AgentTaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTaskApproval" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "AgentTaskApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrchestratorSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "maxConcurrent" INTEGER NOT NULL DEFAULT 2,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrchestratorSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentProfile_archivedAt_position_idx" ON "AgentProfile"("archivedAt", "position");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTask_idempotencyKey_key" ON "AgentTask"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AgentTask_agentId_status_idx" ON "AgentTask"("agentId", "status");

-- CreateIndex
CREATE INDEX "AgentTask_status_createdAt_idx" ON "AgentTask"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTaskEvent_taskId_seq_key" ON "AgentTaskEvent"("taskId", "seq");

-- CreateIndex
CREATE INDEX "AgentTaskApproval_taskId_status_idx" ON "AgentTaskApproval"("taskId", "status");

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTaskEvent" ADD CONSTRAINT "AgentTaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTaskApproval" ADD CONSTRAINT "AgentTaskApproval_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
