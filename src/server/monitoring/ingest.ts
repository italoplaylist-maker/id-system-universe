import { z } from "zod";
import { prisma } from "@/server/db/client";
import { ValidationError } from "@/lib/errors";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { findServerByToken } from "@/server/monitoring/server-service";
import { evaluateServerAlerts } from "@/server/monitoring/alerts";

const num = (max: number) => z.number().finite().min(0).max(max);

export const agentPayloadSchema = z.object({
  agentVersion: z.string().max(20).optional(),
  hostname: z.string().max(120).optional(),
  os: z.string().max(120).optional(),
  kernel: z.string().max(80).optional(),
  cpuModel: z.string().max(160).optional(),
  cpuCores: z.number().int().min(1).max(4096).optional(),
  ipAddress: z.string().max(64).optional(),
  uptimeSec: num(1e10),
  cpuPercent: num(100),
  load: z.tuple([num(1e5), num(1e5), num(1e5)]),
  mem: z.object({ totalMb: num(1e8), usedMb: num(1e8), swapTotalMb: num(1e8).default(0), swapUsedMb: num(1e8).default(0) }),
  disk: z.object({ totalMb: num(1e9), usedMb: num(1e9) }),
  net: z.object({ rxBps: num(1e12), txBps: num(1e12) }).default({ rxBps: 0, txBps: 0 }),
  diskIo: z.object({ readBps: num(1e12), writeBps: num(1e12) }).default({ readBps: 0, writeBps: 0 }),
  procs: num(1e7).default(0),
  containersTotal: num(1e5).optional(),
  containers: z
    .array(z.object({ name: z.string().max(120), cpuPercent: num(1e5), memMb: num(1e7), memPercent: num(100), running: z.boolean().default(true) }))
    .max(200)
    .default([]),
});

export type AgentPayload = z.infer<typeof agentPayloadSchema>;

/** Um sinal a cada ≥5 s por servidor; o agente envia a cada ~15 s. */
const MIN_INTERVAL_MS = 5_000;

export async function ingestAgentMetrics(token: string, body: unknown, ip?: string) {
  const server = await findServerByToken(token);
  consumeRateLimit(`agent:${server.id}`, 1, MIN_INTERVAL_MS);

  const parsed = agentPayloadSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ValidationError(`Payload inválido: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`.trim());
  }
  const p = parsed.data;
  const running = p.containers.filter((c) => c.running);
  const top = [...running]
    .sort((a, b) => b.cpuPercent - a.cpuPercent || b.memMb - a.memMb)
    .slice(0, 12)
    .map((c) => ({ name: c.name, cpuPercent: round1(c.cpuPercent), memMb: Math.round(c.memMb), memPercent: round1(c.memPercent) }));
  const now = new Date();

  await prisma.$transaction([
    prisma.serverMetric.create({
      data: {
        serverId: server.id,
        ts: now,
        cpuPercent: p.cpuPercent,
        load1: p.load[0],
        load5: p.load[1],
        load15: p.load[2],
        memUsedMb: Math.round(p.mem.usedMb),
        memTotalMb: Math.round(p.mem.totalMb),
        swapUsedMb: Math.round(p.mem.swapUsedMb),
        swapTotalMb: Math.round(p.mem.swapTotalMb),
        diskUsedMb: Math.round(p.disk.usedMb),
        diskTotalMb: Math.round(p.disk.totalMb),
        netRxBps: p.net.rxBps,
        netTxBps: p.net.txBps,
        diskReadBps: p.diskIo.readBps,
        diskWriteBps: p.diskIo.writeBps,
        procs: Math.round(p.procs),
        containersRunning: running.length,
        containersTotal: Math.round(p.containersTotal ?? p.containers.length),
        uptimeSec: Math.round(p.uptimeSec),
      },
    }),
    prisma.monitoredServer.update({
      where: { id: server.id },
      data: {
        lastSeenAt: now,
        hostname: p.hostname ?? server.hostname,
        os: p.os ?? server.os,
        kernel: p.kernel ?? server.kernel,
        cpuModel: p.cpuModel ?? server.cpuModel,
        cpuCores: p.cpuCores ?? server.cpuCores,
        agentVersion: p.agentVersion ?? server.agentVersion,
        ipAddress: p.ipAddress ?? ip ?? server.ipAddress,
        latestContainers: top,
      },
    }),
  ]);

  await evaluateServerAlerts(server.id).catch(() => undefined);
  return { ok: true as const };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
