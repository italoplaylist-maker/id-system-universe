-- CreateTable
CREATE TABLE "MonitoredServer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "hostname" TEXT,
    "os" TEXT,
    "kernel" TEXT,
    "cpuModel" TEXT,
    "cpuCores" INTEGER,
    "agentVersion" TEXT,
    "ipAddress" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "latestContainers" JSONB,
    "alertState" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoredServer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerMetric" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cpuPercent" DOUBLE PRECISION NOT NULL,
    "load1" DOUBLE PRECISION NOT NULL,
    "load5" DOUBLE PRECISION NOT NULL,
    "load15" DOUBLE PRECISION NOT NULL,
    "memUsedMb" INTEGER NOT NULL,
    "memTotalMb" INTEGER NOT NULL,
    "swapUsedMb" INTEGER NOT NULL DEFAULT 0,
    "swapTotalMb" INTEGER NOT NULL DEFAULT 0,
    "diskUsedMb" INTEGER NOT NULL,
    "diskTotalMb" INTEGER NOT NULL,
    "netRxBps" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netTxBps" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "diskReadBps" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "diskWriteBps" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "procs" INTEGER NOT NULL DEFAULT 0,
    "containersRunning" INTEGER NOT NULL DEFAULT 0,
    "containersTotal" INTEGER NOT NULL DEFAULT 0,
    "uptimeSec" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ServerMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MonitoredServer_tokenHash_key" ON "MonitoredServer"("tokenHash");

-- CreateIndex
CREATE INDEX "ServerMetric_serverId_ts_idx" ON "ServerMetric"("serverId", "ts");

-- AddForeignKey
ALTER TABLE "ServerMetric" ADD CONSTRAINT "ServerMetric_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "MonitoredServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
