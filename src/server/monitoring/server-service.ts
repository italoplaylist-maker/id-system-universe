import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { NotFoundError, UnauthorizedLikeError, ValidationError } from "@/lib/errors";
import { recordAuditEvent } from "@/server/audit/audit-log";
import { levelFor, percentOf, serverStatus, type AlertLevel, type ServerStatus } from "@/server/monitoring/thresholds";

type Actor = { userId: string; ip?: string; userAgent?: string };

export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return `isu_${randomBytes(24).toString("hex")}`;
}

const nameSchema = z.object({ name: z.string().trim().min(2, "Informe o nome do servidor.").max(80) });

/** O token só existe em claro nesta resposta — depois, só o hash. */
export async function createServer(input: unknown, actor: Actor): Promise<{ id: string; name: string; token: string }> {
  const parsed = nameSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const token = newToken();
  const server = await prisma.monitoredServer.create({ data: { name: parsed.data.name, tokenHash: hashAgentToken(token) } });
  await recordAuditEvent({ userId: actor.userId, action: "SERVER_CREATED", status: "SUCCESS", entityType: "MonitoredServer", entityId: server.id, metadata: { name: server.name }, ipAddress: actor.ip, userAgent: actor.userAgent });
  return { id: server.id, name: server.name, token };
}

export async function rotateServerToken(id: string, actor: Actor): Promise<{ token: string }> {
  const existing = await prisma.monitoredServer.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("Servidor não encontrado.");
  const token = newToken();
  await prisma.monitoredServer.update({ where: { id }, data: { tokenHash: hashAgentToken(token) } });
  await recordAuditEvent({ userId: actor.userId, action: "SERVER_TOKEN_ROTATED", status: "SUCCESS", entityType: "MonitoredServer", entityId: id, ipAddress: actor.ip, userAgent: actor.userAgent });
  return { token };
}

export async function renameServer(id: string, input: unknown): Promise<void> {
  const parsed = nameSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const result = await prisma.monitoredServer.updateMany({ where: { id }, data: { name: parsed.data.name } });
  if (result.count === 0) throw new NotFoundError("Servidor não encontrado.");
}

export async function deleteServer(id: string, actor: Actor): Promise<void> {
  const existing = await prisma.monitoredServer.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("Servidor não encontrado.");
  await prisma.monitoredServer.delete({ where: { id } });
  await recordAuditEvent({ userId: actor.userId, action: "SERVER_DELETED", status: "SUCCESS", entityType: "MonitoredServer", entityId: id, metadata: { name: existing.name }, ipAddress: actor.ip, userAgent: actor.userAgent });
}

export async function findServerByToken(token: string) {
  if (!/^isu_[0-9a-f]{48}$/.test(token)) throw new UnauthorizedLikeError();
  const server = await prisma.monitoredServer.findUnique({ where: { tokenHash: hashAgentToken(token) } });
  if (!server) throw new UnauthorizedLikeError();
  return server;
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export interface ContainerSnapshot {
  name: string;
  cpuPercent: number;
  memMb: number;
  memPercent: number;
}

export interface ServerLatest {
  at: string;
  cpuPercent: number;
  load: [number, number, number];
  mem: { usedMb: number; totalMb: number; percent: number };
  swap: { usedMb: number; totalMb: number; percent: number };
  disk: { usedMb: number; totalMb: number; percent: number };
  netRxBps: number;
  netTxBps: number;
  diskReadBps: number;
  diskWriteBps: number;
  procs: number;
  containersRunning: number;
  containersTotal: number;
  uptimeSec: number;
}

export interface ServerOverview {
  id: string;
  name: string;
  status: ServerStatus;
  lastSeenAt: string | null;
  hostname: string | null;
  os: string | null;
  kernel: string | null;
  cpuModel: string | null;
  cpuCores: number | null;
  agentVersion: string | null;
  latest: ServerLatest | null;
  levels: { cpu: AlertLevel; mem: AlertLevel; disk: AlertLevel };
  containers: ContainerSnapshot[];
  /** Última hora, ~30 pontos — para sparklines e para a parede do NOC. */
  spark: { cpu: number[]; mem: number[] };
}

type MetricRow = Prisma.ServerMetricGetPayload<Record<string, never>>;

function toLatest(m: MetricRow): ServerLatest {
  return {
    at: m.ts.toISOString(),
    cpuPercent: m.cpuPercent,
    load: [m.load1, m.load5, m.load15],
    mem: { usedMb: m.memUsedMb, totalMb: m.memTotalMb, percent: percentOf(m.memUsedMb, m.memTotalMb) },
    swap: { usedMb: m.swapUsedMb, totalMb: m.swapTotalMb, percent: percentOf(m.swapUsedMb, m.swapTotalMb) },
    disk: { usedMb: m.diskUsedMb, totalMb: m.diskTotalMb, percent: percentOf(m.diskUsedMb, m.diskTotalMb) },
    netRxBps: m.netRxBps,
    netTxBps: m.netTxBps,
    diskReadBps: m.diskReadBps,
    diskWriteBps: m.diskWriteBps,
    procs: m.procs,
    containersRunning: m.containersRunning,
    containersTotal: m.containersTotal,
    uptimeSec: m.uptimeSec,
  };
}

const containerSchema = z.array(z.object({ name: z.string(), cpuPercent: z.number(), memMb: z.number(), memPercent: z.number() }));

export async function listServers(now: Date = new Date()): Promise<ServerOverview[]> {
  const servers = await prisma.monitoredServer.findMany({ orderBy: { createdAt: "asc" } });
  const since = new Date(now.getTime() - 60 * 60_000);
  const result: ServerOverview[] = [];

  for (const server of servers) {
    const [latest, recent] = await Promise.all([
      prisma.serverMetric.findFirst({ where: { serverId: server.id }, orderBy: { ts: "desc" } }),
      prisma.serverMetric.findMany({ where: { serverId: server.id, ts: { gte: since } }, orderBy: { ts: "asc" }, select: { cpuPercent: true, memUsedMb: true, memTotalMb: true } }),
    ]);
    const step = Math.max(1, Math.ceil(recent.length / 30));
    const sampled = recent.filter((_, i) => i % step === 0);
    const latestView = latest ? toLatest(latest) : null;
    const containers = containerSchema.safeParse(server.latestContainers);
    result.push({
      id: server.id,
      name: server.name,
      status: serverStatus(server.lastSeenAt, now),
      lastSeenAt: server.lastSeenAt?.toISOString() ?? null,
      hostname: server.hostname,
      os: server.os,
      kernel: server.kernel,
      cpuModel: server.cpuModel,
      cpuCores: server.cpuCores,
      agentVersion: server.agentVersion,
      latest: latestView,
      levels: latestView
        ? { cpu: levelFor("cpu", latestView.cpuPercent), mem: levelFor("mem", latestView.mem.percent), disk: levelFor("disk", latestView.disk.percent) }
        : { cpu: "ok", mem: "ok", disk: "ok" },
      containers: containers.success ? containers.data : [],
      spark: { cpu: sampled.map((r) => r.cpuPercent), mem: sampled.map((r) => percentOf(r.memUsedMb, r.memTotalMb)) },
    });
  }
  return result;
}

export const RANGES = { "1h": 3600, "6h": 6 * 3600, "24h": 24 * 3600, "7d": 7 * 24 * 3600 } as const;
export type RangeKey = keyof typeof RANGES;

export interface MetricPoint {
  t: string;
  cpu: number;
  mem: number;
  disk: number;
  load1: number;
  netRx: number;
  netTx: number;
  diskRead: number;
  diskWrite: number;
}

interface BucketRow {
  t: Date;
  cpu: number;
  mem: number;
  disk: number;
  load1: number;
  net_rx: number;
  net_tx: number;
  disk_read: number;
  disk_write: number;
}

/** Séries agregadas em ~120 baldes (date_bin) — o gráfico nunca recebe milhares de pontos. */
export async function getServerMetrics(id: string, range: RangeKey, now: Date = new Date()): Promise<{ range: RangeKey; bucketSeconds: number; points: MetricPoint[] }> {
  const server = await prisma.monitoredServer.findUnique({ where: { id }, select: { id: true } });
  if (!server) throw new NotFoundError("Servidor não encontrado.");
  const seconds = RANGES[range];
  const bucketSeconds = Math.max(15, Math.round(seconds / 120));
  const since = new Date(now.getTime() - seconds * 1000);
  const rows = await prisma.$queryRaw<BucketRow[]>(Prisma.sql`
    SELECT date_bin(make_interval(secs => ${bucketSeconds}), "ts", TIMESTAMP '2000-01-01') AS t,
           avg("cpuPercent")::float8 AS cpu,
           avg(100.0 * "memUsedMb" / NULLIF("memTotalMb", 0))::float8 AS mem,
           avg(100.0 * "diskUsedMb" / NULLIF("diskTotalMb", 0))::float8 AS disk,
           avg("load1")::float8 AS load1,
           avg("netRxBps")::float8 AS net_rx, avg("netTxBps")::float8 AS net_tx,
           avg("diskReadBps")::float8 AS disk_read, avg("diskWriteBps")::float8 AS disk_write
    FROM "ServerMetric"
    WHERE "serverId" = ${id} AND "ts" >= ${since}
    GROUP BY 1 ORDER BY 1`);
  return {
    range,
    bucketSeconds,
    points: rows.map((r) => ({
      t: r.t.toISOString(),
      cpu: round(r.cpu),
      mem: round(r.mem ?? 0),
      disk: round(r.disk ?? 0),
      load1: round(r.load1, 2),
      netRx: Math.round(r.net_rx),
      netTx: Math.round(r.net_tx),
      diskRead: Math.round(r.disk_read),
      diskWrite: Math.round(r.disk_write),
    })),
  };
}

function round(value: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
