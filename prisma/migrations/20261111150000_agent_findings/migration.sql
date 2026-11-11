-- CreateTable
CREATE TABLE "AgentFinding" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "applicationName" TEXT,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "category" TEXT NOT NULL DEFAULT 'outro',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fixTaskId" TEXT,
    "fixSentAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "AgentFinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentFinding_fingerprint_key" ON "AgentFinding"("fingerprint");

-- CreateIndex
CREATE INDEX "AgentFinding_updatedAt_idx" ON "AgentFinding"("updatedAt");
