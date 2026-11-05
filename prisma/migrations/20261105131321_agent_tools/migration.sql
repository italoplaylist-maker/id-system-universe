-- AlterTable
ALTER TABLE "AgentProfile" ADD COLUMN     "allowedTools" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "disallowedTools" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "effort" TEXT;

-- CreateTable
CREATE TABLE "AgentMcpServer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "command" TEXT,
    "args" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "url" TEXT,
    "secretsEnc" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentMcpServer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentMcpServer_name_key" ON "AgentMcpServer"("name");
