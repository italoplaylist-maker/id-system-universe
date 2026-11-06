-- AlterTable
ALTER TABLE "AgentProfile" ADD COLUMN     "githubRepositoryId" TEXT,
ADD COLUMN     "githubBranch" TEXT;

-- AddForeignKey
ALTER TABLE "AgentProfile" ADD CONSTRAINT "AgentProfile_githubRepositoryId_fkey" FOREIGN KEY ("githubRepositoryId") REFERENCES "GitHubRepository"("id") ON DELETE SET NULL ON UPDATE CASCADE;
