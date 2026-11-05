-- CreateTable
CREATE TABLE "AgentPullRequest" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "taskId" TEXT,
    "repo" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "baseBranch" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "mergedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentPullRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentPullRequest_agentId_status_idx" ON "AgentPullRequest"("agentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AgentPullRequest_repo_number_key" ON "AgentPullRequest"("repo", "number");

-- AddForeignKey
ALTER TABLE "AgentPullRequest" ADD CONSTRAINT "AgentPullRequest_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
