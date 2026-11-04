-- CreateTable
CREATE TABLE "AgentApproval" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "AgentApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentApproval_sessionId_status_createdAt_idx" ON "AgentApproval"("sessionId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "AgentApproval" ADD CONSTRAINT "AgentApproval_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
