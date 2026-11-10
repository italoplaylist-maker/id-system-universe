import { z } from "zod";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { recordAuditEvent } from "@/server/audit/audit-log";
import { describeSchedule, dueSlot, isValidTime, ROUTINE_GATES, type RoutineGate } from "@/lib/clt-routines";
import { listServers } from "@/server/monitoring/server-service";
import { agentBudget } from "./budget";
import { ACTIVE, submitSystemTask } from "./service";

type Actor = { userId: string; ip?: string; userAgent?: string };

const DAY_MS = 24 * 3600_000;

// ---------------------------------------------------------------------------
// Gatilhos determinísticos (sem Claude): decidem se vale chamar o agente
// ---------------------------------------------------------------------------

export interface GateResult {
  run: boolean;
  /** Marca do estado visto (gravada quando a rotina roda) — hoje só o gatilho "changed" usa. */
  key: string | null;
  reason: string;
}

export async function evaluateGate(gate: string, lastGateKey: string | null, now: Date): Promise<GateResult> {
  switch (gate as RoutineGate) {
    case "changed": {
      const last = await prisma.deploymentRun.findFirst({ where: { status: "SUCCESS" }, orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }], select: { id: true } });
      if (!last) return { run: true, key: null, reason: "sem histórico de deploy: roda por segurança" };
      return last.id === lastGateKey ? { run: false, key: last.id, reason: "nenhum deploy novo desde a última execução" } : { run: true, key: last.id, reason: "há deploy novo" };
    }
    case "alert": {
      const since = new Date(now.getTime() - DAY_MS);
      const [appsInError, failedRuns, servers] = await Promise.all([
        prisma.application.count({ where: { status: "ERROR" } }),
        prisma.deploymentRun.count({ where: { status: "FAILED", finishedAt: { gte: since } } }),
        listServers(now).catch(() => []),
      ]);
      const serverAlerts = servers.filter((s) => s.status === "OFFLINE" || Object.values(s.levels).some((l) => l !== "ok")).length;
      const parts = [appsInError && `${appsInError} aplicação(ões) com erro`, failedRuns && `${failedRuns} deploy(s) falho(s) em 24 h`, serverAlerts && `${serverAlerts} servidor(es) em alerta`].filter(Boolean);
      return parts.length ? { run: true, key: null, reason: parts.join(", ") } : { run: false, key: null, reason: "sem alertas" };
    }
    case "activity": {
      const since = new Date(now.getTime() - DAY_MS);
      const finished = await prisma.agentTask.count({ where: { finishedAt: { gte: since } } });
      return finished > 0 ? { run: true, key: null, reason: `${finished} tarefa(s) terminada(s) em 24 h` } : { run: false, key: null, reason: "a equipe não trabalhou nas últimas 24 h" };
    }
    default:
      return { run: true, key: null, reason: "sempre" };
  }
}

// ---------------------------------------------------------------------------
// Execução de uma rotina
// ---------------------------------------------------------------------------

export interface RoutineOutcome {
  started: boolean;
  outcome: string;
  taskId?: string;
}

/**
 * Dispara UMA rotina. `force` (botão "Executar agora") ignora gatilho e horário, mas NUNCA o orçamento de tokens,
 * o agente pausado nem uma execução anterior da mesma rotina ainda em andamento.
 */
export async function runRoutine(id: string, options: { slot: string | null; force?: boolean; now?: Date }): Promise<RoutineOutcome> {
  const now = options.now ?? new Date();
  const routine = await prisma.agentRoutine.findUnique({ where: { id }, include: { agent: true } });
  if (!routine) throw new NotFoundError("Rotina não encontrada.");

  const finish = async (outcome: string, extra: { taskId?: string; gateKey?: string | null } = {}): Promise<RoutineOutcome> => {
    await prisma.agentRoutine.update({
      where: { id },
      data: { lastRunAt: now, lastOutcome: outcome, ...(extra.taskId ? { lastTaskId: extra.taskId } : {}), ...(extra.gateKey !== undefined ? { lastGateKey: extra.gateKey } : {}) },
    });
    return { started: Boolean(extra.taskId), outcome, taskId: extra.taskId };
  };

  if (routine.agent.archivedAt) return finish("pulada: agente removido");
  if (routine.agent.paused) return finish("pulada: agente pausado");

  const open = await prisma.agentTask.findFirst({ where: { routineId: id, status: { in: ["QUEUED", ...ACTIVE] } }, select: { id: true } });
  if (open) return finish("pulada: a execução anterior ainda está em andamento");

  let gateKey: string | null | undefined;
  if (!options.force) {
    const gate = await evaluateGate(routine.gate, routine.lastGateKey, now);
    if (!gate.run) return finish(`pulada: ${gate.reason}`);
    gateKey = gate.key;
  }

  const budget = await agentBudget(routine.agentId, { dailyTokenLimit: routine.agent.dailyTokenLimit, monthlyTokenLimit: routine.agent.monthlyTokenLimit }, now);
  if (budget.blocked) return finish(`pulada: ${budget.reason}`);

  const key = options.force ? `routine:${id}:manual:${now.getTime()}` : `routine:${id}:${options.slot ?? now.getTime()}`;
  const { task } = await submitSystemTask({ agentId: routine.agentId, prompt: routine.prompt, idempotencyKey: key, priority: routine.priority, routineId: id });
  return finish(options.force ? "iniciada (manual)" : "iniciada", { taskId: task.id, gateKey: gateKey ?? undefined });
}

/**
 * O relógio: chamado a cada minuto pelo servidor. Para cada rotina ligada e devida agora, "reivindica" o horário
 * com um UPDATE condicional (só um processo ganha) e só então executa — reinício ou réplica não duplicam.
 */
export async function runRoutinesTick(now: Date = new Date()): Promise<RoutineOutcome[]> {
  const routines = await prisma.agentRoutine.findMany({ where: { enabled: true }, select: { id: true, days: true, time: true, lastSlot: true } });
  const results: RoutineOutcome[] = [];
  for (const r of routines) {
    const slot = dueSlot(r, now);
    if (!slot || r.lastSlot === slot) continue;
    const claim = await prisma.agentRoutine.updateMany({ where: { id: r.id, OR: [{ lastSlot: null }, { lastSlot: { not: slot } }] }, data: { lastSlot: slot } });
    if (claim.count !== 1) continue;
    try {
      results.push(await runRoutine(r.id, { slot, now }));
    } catch (error) {
      logger.error("routine_run_failed", { routineId: r.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Leitura e edição (painel)
// ---------------------------------------------------------------------------

export interface RoutineView {
  id: string;
  agentId: string;
  agentName: string;
  name: string;
  prompt: string;
  enabled: boolean;
  days: number[];
  time: string;
  priority: number;
  gate: RoutineGate;
  schedule: string;
  lastRunAt: string | null;
  lastOutcome: string | null;
  lastTaskId: string | null;
}

const toView = (r: Awaited<ReturnType<typeof prisma.agentRoutine.findMany>>[number] & { agent: { name: string } }): RoutineView => ({
  id: r.id,
  agentId: r.agentId,
  agentName: r.agent.name,
  name: r.name,
  prompt: r.prompt,
  enabled: r.enabled,
  days: r.days,
  time: r.time,
  priority: r.priority,
  gate: r.gate as RoutineGate,
  schedule: describeSchedule(r),
  lastRunAt: r.lastRunAt?.toISOString() ?? null,
  lastOutcome: r.lastOutcome,
  lastTaskId: r.lastTaskId,
});

export async function listRoutines(): Promise<RoutineView[]> {
  const rows = await prisma.agentRoutine.findMany({ where: { agent: { archivedAt: null } }, include: { agent: { select: { name: true, position: true } } }, orderBy: [{ time: "asc" }, { name: "asc" }] });
  return rows.map(toView);
}

const patchSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  prompt: z.string().trim().min(10, "Descreva o que a rotina deve fazer.").max(6000).optional(),
  enabled: z.boolean().optional(),
  days: z.array(z.number().int().min(0).max(6)).min(1, "Marque ao menos um dia.").max(7).optional(),
  time: z.string().refine(isValidTime, "Horário inválido (use HH:MM).").optional(),
  priority: z.number().int().min(-1).max(1).optional(),
  gate: z.enum(ROUTINE_GATES.map((g) => g.id) as [RoutineGate, ...RoutineGate[]]).optional(),
  agentId: z.string().max(40).optional(),
});

export async function updateRoutine(id: string, input: unknown, actor: Actor): Promise<RoutineView> {
  const parsed = patchSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const existing = await prisma.agentRoutine.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("Rotina não encontrada.");
  const data = parsed.data;
  if (data.agentId) {
    const agent = await prisma.agentProfile.findUnique({ where: { id: data.agentId }, select: { archivedAt: true } });
    if (!agent || agent.archivedAt) throw new ValidationError("Agente não encontrado.");
  }
  const days = data.days ? [...new Set(data.days)].sort((a, b) => a - b) : undefined;
  // Mudou o horário ou os dias: o horário de hoje volta a poder disparar.
  const rescheduled = (data.time && data.time !== existing.time) || days !== undefined;
  const updated = await prisma.agentRoutine.update({
    where: { id },
    data: { ...data, ...(days ? { days } : {}), ...(rescheduled ? { lastSlot: null } : {}), ...(data.gate && data.gate !== existing.gate ? { lastGateKey: null } : {}) },
    include: { agent: { select: { name: true } } },
  });
  await recordAuditEvent({ userId: actor.userId, action: "AGENT_PROFILE_UPDATED", status: "SUCCESS", entityType: "AgentRoutine", entityId: id, metadata: { fields: Object.keys(data) }, ipAddress: actor.ip, userAgent: actor.userAgent });
  return toView(updated);
}
