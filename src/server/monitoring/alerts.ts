import { z } from "zod";
import { prisma } from "@/server/db/client";
import { recordUniverseEvent, type UniverseEventType } from "@/server/events/universe-events";
import { levelFor, percentOf, serverStatus, type AlertLevel } from "@/server/monitoring/thresholds";

const stateSchema = z.object({
  offline: z.boolean().default(false),
  cpu: z.enum(["ok", "warning", "critical"]).default("ok"),
  mem: z.enum(["ok", "warning", "critical"]).default("ok"),
  disk: z.enum(["ok", "warning", "critical"]).default("ok"),
});
type AlertState = z.infer<typeof stateSchema>;

const HIGH_EVENT = { cpu: "SERVER_CPU_HIGH", mem: "SERVER_MEM_HIGH", disk: "SERVER_DISK_HIGH" } as const satisfies Record<string, UniverseEventType>;
const LABEL = { cpu: "CPU", mem: "Memória", disk: "Disco" } as const;

/**
 * Eventos só nas TRANSIÇÕES (ok→crítico, online→offline…), guardadas em `alertState`.
 * CPU usa a média das últimas 5 amostras para um pico isolado não alarmar.
 */
export async function evaluateServerAlerts(serverId: string, now: Date = new Date()): Promise<void> {
  const server = await prisma.monitoredServer.findUnique({ where: { id: serverId } });
  if (!server) return;
  const prev: AlertState = stateSchema.catch({ offline: false, cpu: "ok", mem: "ok", disk: "ok" }).parse(server.alertState ?? {});
  const next: AlertState = { ...prev };

  const status = serverStatus(server.lastSeenAt, now);
  if (status === "WAITING") return;
  next.offline = status === "OFFLINE";

  const events: Array<{ type: UniverseEventType; message: string }> = [];

  if (next.offline && !prev.offline) {
    events.push({ type: "SERVER_OFFLINE", message: `Servidor ${server.name} parou de enviar métricas.` });
  } else if (!next.offline && prev.offline) {
    events.push({ type: "SERVER_RECOVERED", message: `Servidor ${server.name} voltou a enviar métricas.` });
  }

  if (!next.offline) {
    const recent = await prisma.serverMetric.findMany({ where: { serverId }, orderBy: { ts: "desc" }, take: 5 });
    const latest = recent[0];
    if (latest) {
      const cpuAvg = recent.reduce((s, r) => s + r.cpuPercent, 0) / recent.length;
      const levels: Record<"cpu" | "mem" | "disk", { level: AlertLevel; value: number }> = {
        cpu: { level: levelFor("cpu", cpuAvg), value: cpuAvg },
        mem: { level: levelFor("mem", percentOf(latest.memUsedMb, latest.memTotalMb)), value: percentOf(latest.memUsedMb, latest.memTotalMb) },
        disk: { level: levelFor("disk", percentOf(latest.diskUsedMb, latest.diskTotalMb)), value: percentOf(latest.diskUsedMb, latest.diskTotalMb) },
      };
      for (const kind of ["cpu", "mem", "disk"] as const) {
        const { level, value } = levels[kind];
        if (level === "critical" && prev[kind] !== "critical") {
          events.push({ type: HIGH_EVENT[kind], message: `${LABEL[kind]} crítica em ${server.name}: ${value.toFixed(0)}%.` });
        }
        next[kind] = level;
      }
    }
  }

  if (JSON.stringify(prev) !== JSON.stringify(next)) {
    await prisma.monitoredServer.update({ where: { id: serverId }, data: { alertState: next } });
  }
  for (const event of events) await recordUniverseEvent(event);
}

/** Detecta servidores que sumiram (sem ingest não há gatilho) e poda métricas antigas. */
export async function runMonitoringTick(now: Date = new Date()): Promise<void> {
  const servers = await prisma.monitoredServer.findMany({ where: { lastSeenAt: { not: null } }, select: { id: true } });
  for (const { id } of servers) await evaluateServerAlerts(id, now);
}

export const METRIC_RETENTION_DAYS = 7;

export async function pruneOldMetrics(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - METRIC_RETENTION_DAYS * 86_400_000);
  const result = await prisma.serverMetric.deleteMany({ where: { ts: { lt: cutoff } } });
  return result.count;
}
