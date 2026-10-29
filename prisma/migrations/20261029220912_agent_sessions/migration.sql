-- CreateTable
CREATE TABLE "AgentFeed" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentFeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSession" (
    "id" TEXT NOT NULL,
    "feedId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "repo" TEXT,
    "branch" TEXT,
    "model" TEXT,
    "phase" TEXT NOT NULL DEFAULT 'WORKING',
    "lastTool" TEXT,
    "lastTarget" TEXT,
    "lastToolFailed" BOOLEAN NOT NULL DEFAULT false,
    "toolCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "AgentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "tool" TEXT,
    "target" TEXT,
    "ok" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AgentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentFeed_tokenHash_key" ON "AgentFeed"("tokenHash");

-- CreateIndex
CREATE INDEX "AgentSession_lastEventAt_idx" ON "AgentSession"("lastEventAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentSession_feedId_externalId_key" ON "AgentSession"("feedId", "externalId");

-- CreateIndex
CREATE INDEX "AgentEvent_sessionId_ts_idx" ON "AgentEvent"("sessionId", "ts");

-- CreateIndex
CREATE INDEX "AgentEvent_ts_idx" ON "AgentEvent"("ts");

-- AddForeignKey
ALTER TABLE "AgentSession" ADD CONSTRAINT "AgentSession_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "AgentFeed"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
