import { prisma } from "@/server/db/client";
import { NotFoundError } from "@/lib/errors";
import { DASHBOARD_DAYS, bucketByDay, lastDays } from "@/lib/clt-dashboard";
import { describeSchedule } from "@/lib/clt-routines";
import { listServers } from "@/server/monitoring/server-service";
import { listErrorGroups, type ErrorGroupView } from "@/server/monitoring/error-collector";
import { cltOverview, teamOverview, type CltAgentOverview } from "./clt";
import { commercialWorkspace } from "./commercial";
import { listIncidents, type IncidentView } from "./incidents";

export interface DashboardTask {
  id: string;
  status: string;
  prompt: string;
  result: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  tokens: number;
  fromRoutine: boolean;
  delegated: boolean;
}

export interface ManagerOperation {
  appStatus: Record<string, number>;
  servers: { online: number; offline: number; inAlert: number };
  errorsByDay: number[];
  errorsBySystem: Array<{ name: string; count: number }>;
  topErrors: ErrorGroupView[];
  deploysByDay: { success: number[]; failed: number[] };
  delegations: Array<{ id: string; to: string; prompt: string; status: string; at: string; result: string | null }>;
  delegationsToday: number;
  /** Incidentes de deploy (mais recentes primeiro): em conserto, resolvidos e os que precisam de humano. */
  incidents: IncidentView[];
}

export interface CltDashboard {
  agent: CltAgentOverview;
  days: string[];
  tokensByDay: number[];
  tasksByDay: { completed: number[]; failed: number[] };
  kpis: { tasks: { completed: number; failed: number; running: number; pending: number }; successRate: number | null; avgSeconds: number | null; efficiency: { tokensPerTask: number | null; cachePercent: number | null; wastedPercent: number | null } };
  recentTasks: DashboardTask[];
  routines: Array<{ id: string; name: string; schedule: string; enabled: boolean; gate: string; priority: number; lastRunAt: string | null; lastOutcome: string | null }>;
  /** Só para o ID Manager. */
  operation: ManagerOperation | null;
  team: Array<{ id: string; name: string; roleTitle: string | null; state: string; dayPercent: number | null; running: number; pending: number }>;
}

const sum = (a: { inputTokens: number | null; outputTokens: number | null; cacheTokens: number | null }) => (a.inputTokens ?? 0) + (a.outputTokens ?? 0) + (a.cacheTokens ?? 0);

async function managerOperation(days: string[], now: Date): Promise<ManagerOperation> {
  const since = new Date(now.getTime() - DASHBOARD_DAYS * 24 * 3600_000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600_000);
  const [apps, servers, daily, byApp, groups, runs, delegated, today, incidents] = await Promise.all([
    prisma.application.groupBy({ by: ["status"], where: { provider: { enabled: true } }, _count: { _all: true } }),
    listServers(now).catch(() => []),
    prisma.errorDaily.findMany({ where: { day: { gte: days[0] } }, select: { day: true, count: true } }),
    prisma.errorDaily.groupBy({ by: ["applicationId"], where: { day: { gte: days[Math.max(0, days.length - 7)] } }, _sum: { count: true }, orderBy: { _sum: { count: "desc" } }, take: 6 }),
    listErrorGroups({ hours: 24 * 7, limit: 6 }),
    prisma.deploymentRun.findMany({ where: { finishedAt: { gte: since }, status: { in: ["SUCCESS", "FAILED"] } }, select: { finishedAt: true, status: true } }),
    prisma.agentTask.findMany({ where: { parentTaskId: { not: null }, createdAt: { gte: weekAgo } }, orderBy: { createdAt: "desc" }, take: 8, include: { agent: { select: { name: true } } } }),
    prisma.agentTask.count({ where: { parentTaskId: { not: null }, createdAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } } }),
    listIncidents(8),
  ]);
  const names = byApp.length ? await prisma.application.findMany({ where: { id: { in: byApp.map((b) => b.applicationId) } }, select: { id: true, name: true } }) : [];
  return {
    appStatus: Object.fromEntries(apps.map((a) => [a.status, a._count._all])),
    servers: { online: servers.filter((s) => s.status === "ONLINE").length, offline: servers.filter((s) => s.status === "OFFLINE").length, inAlert: servers.filter((s) => s.status === "ONLINE" && Object.values(s.levels).some((l) => l !== "ok")).length },
    errorsByDay: bucketByDayKey(daily, days),
    errorsBySystem: byApp.map((b) => ({ name: names.find((n) => n.id === b.applicationId)?.name ?? "—", count: b._sum.count ?? 0 })),
    topErrors: groups,
    deploysByDay: {
      success: bucketByDay(runs.filter((r) => r.status === "SUCCESS").map((r) => ({ at: r.finishedAt, value: 1 })), days),
      failed: bucketByDay(runs.filter((r) => r.status === "FAILED").map((r) => ({ at: r.finishedAt, value: 1 })), days),
    },
    delegations: delegated.map((t) => ({ id: t.id, to: t.agent.name, prompt: t.prompt.replace("[Delegada pelo ID Manager] ", ""), status: t.status, at: t.createdAt.toISOString(), result: t.result })),
    delegationsToday: today,
    incidents,
  };
}

/** Eficiência no uso de tokens: custo médio por tarefa concluída, parte vinda de cache (barata) e parte gasta em tarefas que falharam. */
export function efficiency(rows: Array<{ status: string; inputTokens: number | null; outputTokens: number | null; cacheTokens: number | null }>): { tokensPerTask: number | null; cachePercent: number | null; wastedPercent: number | null } {
  const total = rows.reduce((n, r) => n + sum(r), 0);
  const done = rows.filter((r) => r.status === "COMPLETED");
  const lost = rows.filter((r) => r.status !== "COMPLETED").reduce((n, r) => n + sum(r), 0);
  const cache = rows.reduce((n, r) => n + (r.cacheTokens ?? 0), 0);
  return {
    tokensPerTask: done.length ? Math.round(done.reduce((n, r) => n + sum(r), 0) / done.length) : null,
    cachePercent: total > 0 ? Math.round((cache / total) * 100) : null,
    wastedPercent: total > 0 ? Math.round((lost / total) * 100) : null,
  };
}

/** ErrorDaily já vem por dia ("AAAA-MM-DD"): soma por chave de dia. */
function bucketByDayKey(rows: Array<{ day: string; count: number }>, days: string[]): number[] {
  const out = days.map(() => 0);
  for (const r of rows) {
    const i = days.indexOf(r.day);
    if (i >= 0) out[i] += r.count;
  }
  return out;
}

/** Painel de UM agente da equipe CLT: tokens e tarefas por dia, últimas tarefas, rotinas e — no ID Manager — a visão da operação. */
export async function cltAgentDashboard(agentId: string, now: Date = new Date()): Promise<CltDashboard> {
  const owner = await prisma.agentProfile.findUnique({ where: { id: agentId }, select: { team: true } });
  const overview = owner?.team === "COMERCIAL" ? await teamOverview("COMERCIAL", commercialWorkspace(), now) : await cltOverview(now);
  const agent = overview.agents.find((a) => a.id === agentId);
  if (!agent) throw new NotFoundError("Agente da equipe CLT não encontrado.");

  const days = lastDays(DASHBOARD_DAYS, now);
  const since = new Date(now.getTime() - DASHBOARD_DAYS * 24 * 3600_000);
  const [finished, recent, routines] = await Promise.all([
    prisma.agentTask.findMany({ where: { agentId, finishedAt: { gte: since } }, select: { status: true, startedAt: true, finishedAt: true, inputTokens: true, outputTokens: true, cacheTokens: true } }),
    prisma.agentTask.findMany({ where: { agentId }, orderBy: { createdAt: "desc" }, take: 12 }),
    prisma.agentRoutine.findMany({ where: { agentId }, orderBy: { time: "asc" } }),
  ]);

  const done = finished.filter((t) => t.status === "COMPLETED");
  const failed = finished.filter((t) => t.status === "FAILED" || t.status === "INTERRUPTED");
  const durations = done.filter((t) => t.startedAt && t.finishedAt).map((t) => (t.finishedAt!.getTime() - t.startedAt!.getTime()) / 1000);
  const total = done.length + failed.length;

  return {
    agent,
    days,
    tokensByDay: bucketByDay(finished.map((t) => ({ at: t.finishedAt, value: sum(t) })), days),
    tasksByDay: { completed: bucketByDay(done.map((t) => ({ at: t.finishedAt, value: 1 })), days), failed: bucketByDay(failed.map((t) => ({ at: t.finishedAt, value: 1 })), days) },
    kpis: { tasks: agent.tasks, successRate: total > 0 ? Math.round((done.length / total) * 100) : null, avgSeconds: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null, efficiency: efficiency(finished) },
    recentTasks: recent.map((t) => ({
      id: t.id,
      status: t.status,
      prompt: t.prompt.replace("[Delegada pelo ID Manager] ", "").slice(0, 400),
      result: t.result?.slice(0, 1500) ?? null,
      error: t.error?.slice(0, 400) ?? null,
      startedAt: t.startedAt?.toISOString() ?? null,
      finishedAt: t.finishedAt?.toISOString() ?? null,
      tokens: sum(t),
      fromRoutine: t.routineId !== null,
      delegated: t.parentTaskId !== null,
    })),
    routines: routines.map((r) => ({ id: r.id, name: r.name, schedule: describeSchedule(r), enabled: r.enabled, gate: r.gate, priority: r.priority, lastRunAt: r.lastRunAt?.toISOString() ?? null, lastOutcome: r.lastOutcome })),
    operation: agent.slug === "id-manager" ? await managerOperation(days, now) : null,
    team: overview.agents.map((a) => ({ id: a.id, name: a.name, roleTitle: a.roleTitle, state: a.state, dayPercent: a.usage.dayPercent, running: a.tasks.running, pending: a.tasks.pending })),
  };
}
