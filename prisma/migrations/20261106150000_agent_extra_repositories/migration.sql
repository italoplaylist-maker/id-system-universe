-- CreateTable
CREATE TABLE "AgentRepository" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "githubRepositoryId" TEXT NOT NULL,
    "branch" TEXT,
    "dir" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRepository_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentRepository_agentId_githubRepositoryId_key" ON "AgentRepository"("agentId", "githubRepositoryId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRepository_agentId_dir_key" ON "AgentRepository"("agentId", "dir");

-- AddForeignKey
ALTER TABLE "AgentRepository" ADD CONSTRAINT "AgentRepository_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRepository" ADD CONSTRAINT "AgentRepository_githubRepositoryId_fkey" FOREIGN KEY ("githubRepositoryId") REFERENCES "GitHubRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
