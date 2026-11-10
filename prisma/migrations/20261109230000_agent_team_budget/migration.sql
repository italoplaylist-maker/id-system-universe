-- AlterTable (colunas do "AGENTES CLT" já usadas pelo código, sem migração correspondente)
ALTER TABLE "AgentProfile" ADD COLUMN     "dailyTokenLimit" INTEGER,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "monthlyTokenLimit" INTEGER,
ADD COLUMN     "roleTitle" TEXT,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "team" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AgentProfile_slug_key" ON "AgentProfile"("slug");
