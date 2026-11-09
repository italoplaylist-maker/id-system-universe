-- AlterTable (colunas já usadas pelo código desde o PR "uso do plano do Claude", sem migração correspondente)
ALTER TABLE "AgentTask" ADD COLUMN     "cacheTokens" INTEGER,
ADD COLUMN     "inputTokens" INTEGER,
ADD COLUMN     "outputTokens" INTEGER;
