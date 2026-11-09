import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { recordAuditEvent } from "@/server/audit/audit-log";
import { CLT_DISALLOWED_TOOLS, CLT_TEAM, CLT_TEAM_ID, cltAllowedTools, evaluateBudget, findDuplicate, routeTask, type RouteDecision } from "@/lib/clt-team";
import { orchestratorBus } from "./bus";
import { agentBudget, windowStarts } from "./budget";
import { ACTIVE, listRoomAgents, submitTask, type RoomAgentView, type TaskView } from "./service";

type Actor = { userId: string; ip?: string; userAgent?: string };

/**
 * Cria (uma única vez, por slug) os 7 funcionários da equipe AGENTES CLT. Idempotente: nunca duplica nem sobrescreve
 * a configuração que o usuário já ajustou. Repositórios autorizados NÃO são ligados aqui — dependem de configuração
 * (GitHub App + "Trocar repositório" em cada agente); sem repositório, o agente não acessa nenhum.
 */
export async function ensureCltTeam(actor: Actor): Promise<{ created: string[]; existing: string[] }> {
  const existingRows = await prisma.agentProfile.findMany({ where: { slug: { in: CLT_TEAM.map((a) => a.slug) } }, select: { slug: true } });
  const have = new Set(existingRows.map((r) => r.slug));
  const missing = CLT_TEAM.filter((a) => !have.has(a.slug));
  if (missing.length === 0) return { created: [], existing: [...have].filter((s): s is string => !!s) };

  const cwd =
    process.env.CLT_AGENTS_CWD?.trim() ||
    (await prisma.agentProfile.findFirst({ where: { archivedAt: null, team: null }, orderBy: { position: "asc" }, select: { cwd: true } }))?.cwd;
  if (!cwd || !cwd.startsWith("/")) throw new ValidationError("Defina CLT_AGENTS_CWD (caminho absoluto no servidor) ou crie antes um agente com diretório de trabalho.");

  const last = await prisma.agentProfile.aggregate({ _max: { position: true } });
  let position = (last._max.position ?? -1) + 1;
  const created: string[] = [];
  for (const def of missing) {
    await prisma.agentProfile.create({
      data: {
        name: def.name,
        specialty: def.specialty,
        cwd,
        model: def.model,
        effort: def.effort,
        permissionMode: def.permissionMode,
        allowedTools: cltAllowedTools(),
        disallowedTools: CLT_DISALLOWED_TOOLS,
        team: CLT_TEAM_ID,
        slug: def.slug,
        roleTitle: def.roleTitle,
        description: def.description,
        dailyTokenLimit: def.dailyTokenLimit,
        monthlyTokenLimit: def.monthlyTokenLimit,
        position: position++,
      },
    });
    created.push(def.slug);
  }
  await recordAuditEvent({ userId: actor.userId, action: "AGENT_PROFILE_CREATED", status: "SUCCESS", entityType: "AgentProfile", entityId: "clt-team", metadata: { team: CLT_TEAM_ID, created }, ipAddress: actor.ip, userAgent: actor.userAgent });
  orchestratorBus.emit({ type: "agent", agentId: "clt-team" });
  return { created, existing: [...have].filter((s): s is string => !!s) };
}

export interface CltAgentOverview extends RoomAgentView {
  usage: { usedDay: number; usedMonth: number; dayPercent: number | null; monthPercent: number | null; level: "ok" | "warn" | "blocked"; reason: string | null };
  tasks: { running: number; pending: number; completed: number; failed: number };
}

export interface CltOverview {
  agents: CltAgentOverview[];
  totals: {
    agents: number;
    working: number;
    available: number;
    waiting: number;
    errored: number;
    paused: number;
    tasksRunning: number;
    tasksPending: number;
    tasksCompleted: number;
    tokensDay: number;
    tokensMonth: number;
  };
}

/** Painel da equipe: tudo vem de sessões, tarefas e tokens reais gravados — nada é estimado nem simulado. */
export async function cltOverview(now: Date = new Date()): Promise<CltOverview> {
  const team = (await listRoomAgents(now)).filter((a) => a.team === CLT_TEAM_ID);
  const ids = team.map((a) => a.id);
  const w = windowStarts(now);
  const [counts, day, month] = ids.length
    ? await Promise.all([
        prisma.agentTask.groupBy({ by: ["agentId", "status"], where: { agentId: { in: ids } }, _count: { _all: true } }),
        prisma.agentTask.groupBy({ by: ["agentId"], where: { agentId: { in: ids }, finishedAt: { gte: w.day } }, _sum: { inputTokens: true, outputTokens: true, cacheTokens: true } }),
        prisma.agentTask.groupBy({ by: ["agentId"], where: { agentId: { in: ids }, finishedAt: { gte: w.month } }, _sum: { inputTokens: true, outputTokens: true, cacheTokens: true } }),
      ])
    : [[], [], []];
  const sum = (r?: { _sum: { inputTokens: number | null; outputTokens: number | null; cacheTokens: number | null } }) => (r ? (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0) + (r._sum.cacheTokens ?? 0) : 0);

  const agents: CltAgentOverview[] = team.map((a) => {
    const c = (statuses: string[]) => counts.filter((r) => r.agentId === a.id && statuses.includes(r.status)).reduce((n, r) => n + r._count._all, 0);
    const usedDay = sum(day.find((r) => r.agentId === a.id));
    const usedMonth = sum(month.find((r) => r.agentId === a.id));
    const b = evaluateBudget({ usedDay, usedMonth, dailyLimit: a.dailyTokenLimit, monthlyLimit: a.monthlyTokenLimit });
    return {
      ...a,
      usage: { usedDay, usedMonth, dayPercent: b.dayPercent, monthPercent: b.monthPercent, level: b.level, reason: b.reason },
      tasks: { running: c([...ACTIVE]), pending: c(["QUEUED"]), completed: c(["COMPLETED"]), failed: c(["FAILED", "INTERRUPTED"]) },
    };
  });
  const inState = (...s: string[]) => agents.filter((a) => s.includes(a.state)).length;
  return {
    agents,
    totals: {
      agents: agents.length,
      working: inState("RUNNING", "RECEIVING"),
      available: inState("AVAILABLE", "DONE"),
      waiting: inState("WAITING"),
      errored: inState("ERROR"),
      paused: inState("PAUSED"),
      tasksRunning: agents.reduce((n, a) => n + a.tasks.running, 0),
      tasksPending: agents.reduce((n, a) => n + a.tasks.pending, 0),
      tasksCompleted: agents.reduce((n, a) => n + a.tasks.completed, 0),
      tokensDay: agents.reduce((n, a) => n + a.usage.usedDay, 0),
      tokensMonth: agents.reduce((n, a) => n + a.usage.usedMonth, 0),
    },
  };
}

export type RouteOutcome =
  | { kind: "submitted"; decision: RouteDecision; agent: { id: string; name: string }; task: TaskView; duplicate: boolean }
  | { kind: "duplicate"; decision: RouteDecision; agent: { id: string; name: string }; task: { id: string; status: string; prompt: string } };

/**
 * O ID Manager distribui a tarefa SEM gastar token na triagem: regras determinísticas escolhem o especialista;
 * se o pedido cruza especialidades, vai para o próprio ID Manager (que coordena usando o Claude).
 * Recusa tarefa idêntica já na fila/em execução na equipe e agente sem orçamento de tokens.
 */
export async function routeAndSubmit(prompt: string, actor: Actor, idempotencyKey: string = randomUUID()): Promise<RouteOutcome> {
  const text = prompt.trim();
  if (text.length < 3) throw new ValidationError("Descreva a tarefa.");
  const decision = routeTask(text);
  const agent = await prisma.agentProfile.findFirst({ where: { slug: decision.slug, team: CLT_TEAM_ID, archivedAt: null } });
  if (!agent) throw new NotFoundError("A equipe CLT ainda não foi criada (ou o agente foi removido).");

  const open = await prisma.agentTask.findMany({ where: { agent: { team: CLT_TEAM_ID }, status: { in: ["QUEUED", ...ACTIVE] } }, select: { id: true, status: true, prompt: true, agentId: true } });
  const dup = findDuplicate(text, open);
  if (dup) return { kind: "duplicate", decision, agent: { id: agent.id, name: agent.name }, task: { id: dup.id, status: dup.status, prompt: dup.prompt } };

  const budget = await agentBudget(agent.id, { dailyTokenLimit: agent.dailyTokenLimit, monthlyTokenLimit: agent.monthlyTokenLimit });
  if (budget.blocked) throw new ValidationError(`${agent.name}: ${budget.reason}`);

  const { task, duplicate } = await submitTask(agent.id, { prompt: text, idempotencyKey }, actor);
  return { kind: "submitted", decision, agent: { id: agent.id, name: agent.name }, task, duplicate };
}
