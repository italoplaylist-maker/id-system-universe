import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { recordAuditEvent } from "@/server/audit/audit-log";
import { prepareAfterLink, prepareExtrasNow } from "./workspace";
import { freeExtraDir, listExtraRepos } from "./repo-link";
import { redactSecrets } from "@/server/claude/agent-service";
import { orchestratorBus } from "./bus";
import { linkToTask, listForTask, purgeAttachments, validateForTask, type AttachmentView } from "./attachments";

type Actor = { userId: string; ip?: string; userAgent?: string };

/** O worker registra aqui o "acorda já" (evita import circular service ↔ worker). */
const hookHolder = globalThis as unknown as { __isuTaskHook?: () => void };
export function setTaskRegisteredHook(hook: (() => void) | null) {
  hookHolder.__isuTaskHook = hook ?? undefined;
}

export const TERMINAL = ["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"] as const;
export const ACTIVE = ["STARTING", "RUNNING", "WAITING_APPROVAL"] as const;
export type TaskStatus = "QUEUED" | "STARTING" | "RUNNING" | "WAITING_APPROVAL" | "COMPLETED" | "FAILED" | "CANCELLED" | "INTERRUPTED";
export type AgentState = "AVAILABLE" | "RECEIVING" | "RUNNING" | "WAITING" | "DONE" | "ERROR" | "PAUSED";

export const isTerminal = (s: string) => (TERMINAL as readonly string[]).includes(s);
export const isActive = (s: string) => (ACTIVE as readonly string[]).includes(s);

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

export async function appendEvent(taskId: string, kind: string, text?: string, tool?: string): Promise<void> {
  // nextSeq incrementa atomicamente: dois eventos simultâneos nunca colidem.
  const row = await prisma.agentTask.update({ where: { id: taskId }, data: { nextSeq: { increment: 1 } }, select: { nextSeq: true, agentId: true } });
  await prisma.agentTaskEvent.create({ data: { taskId, seq: row.nextSeq - 1, kind, tool, text: text ? redactSecrets(text).slice(0, 4000) : undefined } });
  orchestratorBus.emit({ type: "event", taskId, agentId: row.agentId });
}

// ---------------------------------------------------------------------------
// Agentes (funcionários permanentes)
// ---------------------------------------------------------------------------

const toolRule = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_:*().,\- /@]+$/, "Regra de ferramenta inválida.");

const profileSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do agente.").max(60),
  specialty: z.string().trim().max(120).optional().nullable(),
  cwd: z.string().trim().min(1, "Informe o diretório de trabalho.").max(300).refine((p) => p.startsWith("/"), "O diretório deve ser um caminho absoluto."),
  projectId: z.string().max(40).optional().nullable(),
  model: z.string().trim().max(80).optional().nullable(),
  permissionMode: z.enum(["default", "acceptEdits", "plan"]).default("default"),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional().nullable(),
  allowedTools: z.array(toolRule).max(60).optional(),
  disallowedTools: z.array(toolRule).max(60).optional(),
  githubRepositoryId: z.string().max(40).optional().nullable(),
  githubBranch: z.string().trim().max(120).regex(/^[A-Za-z0-9._\/-]*$/, "Branch inválida.").optional().nullable(),
  /** Cargo e função (instruções) do funcionário — entram no prompt a cada execução. */
  roleTitle: z.string().trim().max(80).optional().nullable(),
  description: z.string().trim().max(4000).optional().nullable(),
  dailyTokenLimit: z.number().int().min(1000).max(2_000_000_000).optional().nullable(),
  monthlyTokenLimit: z.number().int().min(1000).max(2_000_000_000).optional().nullable(),
});

export async function createAgent(input: unknown, actor: Actor) {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const last = await prisma.agentProfile.aggregate({ _max: { position: true } });
  const agent = await prisma.agentProfile.create({
    data: { ...parsed.data, effort: parsed.data.effort || null, specialty: parsed.data.specialty || null, projectId: parsed.data.projectId || null, model: parsed.data.model || null, position: (last._max.position ?? -1) + 1 },
  });
  await recordAuditEvent({ userId: actor.userId, action: "AGENT_PROFILE_CREATED", status: "SUCCESS", entityType: "AgentProfile", entityId: agent.id, metadata: { name: agent.name }, ipAddress: actor.ip, userAgent: actor.userAgent });
  orchestratorBus.emit({ type: "agent", agentId: agent.id });
  return agent;
}

export async function updateAgent(id: string, input: unknown, actor: Actor) {
  const parsed = profileSchema.partial().extend({ paused: z.boolean().optional() }).safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const existing = await prisma.agentProfile.findUnique({ where: { id } });
  if (!existing || existing.archivedAt) throw new NotFoundError("Agente não encontrado.");
  const data = parsed.data;
  if (data.githubRepositoryId) {
    const repo = await prisma.gitHubRepository.findUnique({ where: { id: data.githubRepositoryId }, include: { installation: true } });
    if (!repo || repo.archived || repo.installation.status !== "ACTIVE") throw new ValidationError("Repositório não encontrado ou sem acesso do GitHub App.");
  }
  // Trocar o diretório invalida a sessão (ela pertence ao projeto anterior).
  const resetSession = data.cwd !== undefined && data.cwd !== existing.cwd;
  const agent = await prisma.agentProfile.update({
    where: { id },
    data: { ...data, ...(data.specialty !== undefined ? { specialty: data.specialty || null } : {}), ...(data.roleTitle !== undefined ? { roleTitle: data.roleTitle || null } : {}), ...(data.description !== undefined ? { description: data.description || null } : {}), ...(data.model !== undefined ? { model: data.model || null } : {}), ...(data.effort !== undefined ? { effort: data.effort || null } : {}), ...(data.githubRepositoryId !== undefined ? { githubRepositoryId: data.githubRepositoryId || null } : {}), ...(data.githubBranch !== undefined ? { githubBranch: data.githubBranch || null } : {}), ...(resetSession ? { claudeSessionId: null } : {}) },
  });
  await recordAuditEvent({ userId: actor.userId, action: "AGENT_PROFILE_UPDATED", status: "SUCCESS", entityType: "AgentProfile", entityId: id, ipAddress: actor.ip, userAgent: actor.userAgent });
  orchestratorBus.emit({ type: "agent", agentId: id });
  // Repositório conectado/trocado: já prepara a cópia (clone) para o agente poder publicar sem esperar a próxima tarefa.
  let prepare: { ok: boolean; message: string } | undefined;
  if (data.githubRepositoryId && data.githubRepositoryId !== existing.githubRepositoryId) {
    const work = prepareAfterLink(id);
    prepare = await Promise.race([work, new Promise<{ ok: boolean; message: string }>((r) => setTimeout(() => r({ ok: true, message: "Baixando o repositório em segundo plano…" }), 90_000))]);
    orchestratorBus.emit({ type: "agent", agentId: id });
  }
  return Object.assign(agent, { prepare });
}

/** "Remover" arquiva: o histórico de tarefas fica. */
export async function archiveAgent(id: string, actor: Actor) {
  const existing = await prisma.agentProfile.findUnique({ where: { id } });
  if (!existing || existing.archivedAt) throw new NotFoundError("Agente não encontrado.");
  const busy = await prisma.agentTask.count({ where: { agentId: id, status: { in: ["STARTING", "RUNNING", "WAITING_APPROVAL"] } } });
  if (busy > 0) throw new ValidationError("O agente está executando uma tarefa. Cancele-a antes de remover.");
  await prisma.$transaction([
    prisma.agentTask.updateMany({ where: { agentId: id, status: "QUEUED" }, data: { status: "CANCELLED", finishedAt: new Date(), error: "Agente removido." } }),
    prisma.agentProfile.update({ where: { id }, data: { archivedAt: new Date() } }),
  ]);
  await recordAuditEvent({ userId: actor.userId, action: "AGENT_PROFILE_ARCHIVED", status: "SUCCESS", entityType: "AgentProfile", entityId: id, ipAddress: actor.ip, userAgent: actor.userAgent });
  orchestratorBus.emit({ type: "agent", agentId: id });
}

// ---------------------------------------------------------------------------
// Tarefas
// ---------------------------------------------------------------------------

const submitSchema = z
  .object({
    prompt: z.string().trim().max(20000, "O comando pode ter no máximo 20000 caracteres."),
    idempotencyKey: z.string().min(8, "Chave de envio inválida.").max(100),
    attachmentIds: z.array(z.string().max(60)).max(10, "No máximo 10 anexos por comando.").optional(),
  })
  .refine((v) => v.prompt.length > 0 || (v.attachmentIds?.length ?? 0) > 0, { message: "Escreva o comando ou anexe um arquivo." });

export interface TaskView {
  id: string;
  agentId: string;
  agentName: string;
  prompt: string;
  status: TaskStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  result: string | null;
  error: string | null;
  costUsd: number | null;
  turns: number | null;
  /** Posição na fila do agente/global (1 = próxima), só enquanto QUEUED. */
  queuePosition: number | null;
}

type TaskRow = Prisma.AgentTaskGetPayload<{ include: { agent: { select: { name: true } } } }>;

function toTaskView(t: TaskRow, queuePosition: number | null = null): TaskView {
  return {
    id: t.id,
    agentId: t.agentId,
    agentName: t.agent.name,
    prompt: t.prompt,
    status: t.status as TaskStatus,
    createdAt: t.createdAt.toISOString(),
    startedAt: t.startedAt?.toISOString() ?? null,
    finishedAt: t.finishedAt?.toISOString() ?? null,
    result: t.result,
    error: t.error,
    costUsd: t.costUsd,
    turns: t.turns,
    queuePosition,
  };
}

/**
 * Registra a tarefa e devolve NA HORA (HTTP 202): a execução acontece em background no worker.
 * Idempotente: o mesmo `idempotencyKey` devolve a mesma tarefa, nunca cria outra.
 */
export async function submitTask(agentId: string, input: unknown, actor: Actor): Promise<{ task: TaskView; duplicate: boolean }> {
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Comando inválido.");
  const agent = await prisma.agentProfile.findUnique({ where: { id: agentId } });
  if (!agent || agent.archivedAt) throw new NotFoundError("Agente não encontrado.");

  const existing = await prisma.agentTask.findUnique({ where: { idempotencyKey: parsed.data.idempotencyKey }, include: { agent: { select: { name: true } } } });
  if (existing) return { task: toTaskView(existing), duplicate: true };

  consumeRateLimit(`orchestrator-submit:${actor.userId}`, 30, 60_000);
  const attachmentIds = [...new Set(parsed.data.attachmentIds ?? [])];
  await validateForTask(actor.userId, attachmentIds);
  const promptText = parsed.data.prompt || "Veja os anexos.";
  try {
    const created = await prisma.agentTask.create({
      data: { agentId, prompt: promptText, idempotencyKey: parsed.data.idempotencyKey, createdById: actor.userId },
      include: { agent: { select: { name: true } } },
    });
    await linkToTask(attachmentIds, created.id);
    const names = (await listForTask(created.id)).map((a) => a.name);
    await appendEvent(created.id, "message_sent", names.length ? `${promptText}\n📎 ${names.join(", ")}` : promptText);
    await recordAuditEvent({ userId: actor.userId, action: "AGENT_TASK_SUBMITTED", status: "SUCCESS", entityType: "AgentTask", entityId: created.id, metadata: { agentId, length: promptText.length, attachments: attachmentIds.length }, ipAddress: actor.ip, userAgent: actor.userAgent });
    orchestratorBus.emit({ type: "task", taskId: created.id, agentId });
    // Começa já (não espera o próximo ciclo do worker); a resposta HTTP não depende disso.
    hookHolder.__isuTaskHook?.();
    return { task: toTaskView(created), duplicate: false };
  } catch (error) {
    // Duplo clique em paralelo: a segunda inserção bate na chave única e devolve a tarefa já criada.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const again = await prisma.agentTask.findUnique({ where: { idempotencyKey: parsed.data.idempotencyKey }, include: { agent: { select: { name: true } } } });
      if (again) return { task: toTaskView(again), duplicate: true };
    }
    throw error;
  }
}

/**
 * Tarefa criada pelo SISTEMA (rotina agendada), sem usuário logado. Idempotente: a mesma `idempotencyKey`
 * devolve a mesma tarefa — reinício do servidor ou duas réplicas nunca duplicam uma rotina.
 */
export async function submitSystemTask(input: { agentId: string; prompt: string; idempotencyKey: string; priority?: number; routineId?: string }): Promise<{ task: TaskView; duplicate: boolean }> {
  const existing = await prisma.agentTask.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { agent: { select: { name: true } } } });
  if (existing) return { task: toTaskView(existing), duplicate: true };
  try {
    const created = await prisma.agentTask.create({
      data: { agentId: input.agentId, prompt: input.prompt, idempotencyKey: input.idempotencyKey, createdById: null, priority: input.priority ?? 0, routineId: input.routineId ?? null },
      include: { agent: { select: { name: true } } },
    });
    await appendEvent(created.id, "message_sent", `[Rotina agendada] ${input.prompt}`);
    await recordAuditEvent({ action: "AGENT_TASK_SUBMITTED", status: "SUCCESS", entityType: "AgentTask", entityId: created.id, metadata: { agentId: input.agentId, routineId: input.routineId, source: "routine" } });
    orchestratorBus.emit({ type: "task", taskId: created.id, agentId: input.agentId });
    hookHolder.__isuTaskHook?.();
    return { task: toTaskView(created), duplicate: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const again = await prisma.agentTask.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { agent: { select: { name: true } } } });
      if (again) return { task: toTaskView(again), duplicate: true };
    }
    throw error;
  }
}

export async function listTasks(options: { agentId?: string; scope?: "active" | "history"; limit?: number } = {}): Promise<TaskView[]> {
  const { agentId, scope = "active", limit = 50 } = options;
  const where: Prisma.AgentTaskWhereInput =
    scope === "active" ? { status: { in: ["QUEUED", "STARTING", "RUNNING", "WAITING_APPROVAL"] } } : { status: { in: [...TERMINAL] } };
  const rows = await prisma.agentTask.findMany({
    where: { ...where, ...(agentId ? { agentId } : {}) },
    orderBy: { createdAt: scope === "active" ? "asc" : "desc" },
    take: Math.min(limit, 200),
    include: { agent: { select: { name: true } } },
  });
  let queued = 0;
  return rows.map((t) => toTaskView(t, t.status === "QUEUED" ? ++queued : null));
}

export interface TaskEventView {
  seq: number;
  ts: string;
  kind: string;
  tool: string | null;
  text: string | null;
}

export async function getTaskDetail(id: string, afterSeq = 0): Promise<{ task: TaskView; events: TaskEventView[]; approval: { id: string; tool: string; detail: string } | null; attachments: AttachmentView[] }> {
  const t = await prisma.agentTask.findUnique({ where: { id }, include: { agent: { select: { name: true } } } });
  if (!t) throw new NotFoundError("Tarefa não encontrada.");
  const [events, approval, ahead] = await Promise.all([
    prisma.agentTaskEvent.findMany({ where: { taskId: id, seq: { gt: afterSeq } }, orderBy: { seq: "asc" }, take: 500 }),
    prisma.agentTaskApproval.findFirst({ where: { taskId: id, status: "PENDING" }, orderBy: { createdAt: "asc" } }),
    t.status === "QUEUED" ? prisma.agentTask.count({ where: { status: "QUEUED", createdAt: { lt: t.createdAt } } }) : Promise.resolve(0),
  ]);
  return {
    task: toTaskView(t, t.status === "QUEUED" ? ahead + 1 : null),
    events: events.map((e) => ({ seq: e.seq, ts: e.ts.toISOString(), kind: e.kind, tool: e.tool, text: e.text })),
    approval: approval ? { id: approval.id, tool: approval.tool, detail: approval.detail } : null,
    attachments: await listForTask(id),
  };
}

// ---------------------------------------------------------------------------
// Aprovações (ferramentas que o Claude pede permissão para usar)
// ---------------------------------------------------------------------------

export async function decideTaskApproval(approvalId: string, input: unknown, actor: Actor): Promise<{ status: "APPROVED" | "DENIED" }> {
  const parsed = z.object({ decision: z.enum(["allow", "deny"]) }).safeParse(input);
  if (!parsed.success) throw new ValidationError("Decisão inválida.");
  consumeRateLimit(`orchestrator-approval:${actor.userId}`, 60, 60_000);
  const a = await prisma.agentTaskApproval.findUnique({ where: { id: approvalId }, include: { task: true } });
  if (!a) throw new NotFoundError("Aprovação não encontrada.");
  const status = parsed.data.decision === "allow" ? "APPROVED" : "DENIED";
  const won = await prisma.agentTaskApproval.updateMany({ where: { id: approvalId, status: "PENDING" }, data: { status, decidedById: actor.userId, decidedAt: new Date() } });
  if (won.count === 0) throw new ValidationError("Este pedido já foi decidido ou expirou.");
  await recordAuditEvent({ userId: actor.userId, action: "AGENT_APPROVAL_DECIDED", status: "SUCCESS", entityType: "AgentTask", entityId: a.taskId, metadata: { tool: a.tool, decision: status }, ipAddress: actor.ip, userAgent: actor.userAgent });
  orchestratorBus.emit({ type: "approval", taskId: a.taskId, agentId: a.task.agentId });
  return { status };
}

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

export async function getSettings() {
  const row = await prisma.orchestratorSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: {} });
  return { maxConcurrent: row.maxConcurrent, autoApprove: row.autoApprove };
}

export async function updateSettings(input: unknown, actor: Actor) {
  const parsed = z.object({ maxConcurrent: z.number().int().min(1).max(16).optional(), autoApprove: z.boolean().optional() }).safeParse(input);
  if (!parsed.success || (parsed.data.maxConcurrent === undefined && parsed.data.autoApprove === undefined)) throw new ValidationError("O limite de execuções simultâneas deve estar entre 1 e 16.");
  const data = parsed.data;
  await prisma.orchestratorSetting.upsert({ where: { id: "default" }, create: { id: "default", ...data }, update: data });
  await recordAuditEvent({ userId: actor.userId, action: "ORCHESTRATOR_SETTINGS_UPDATED", status: "SUCCESS", entityType: "OrchestratorSetting", entityId: "default", metadata: data, ipAddress: actor.ip, userAgent: actor.userAgent });
  orchestratorBus.emit({ type: "settings" });
  return getSettings();
}

// ---------------------------------------------------------------------------
// Visão da sala: um funcionário por agente, SEMPRE presente
// ---------------------------------------------------------------------------

export interface RoomAgentView {
  id: string;
  name: string;
  specialty: string | null;
  cwd: string;
  projectId: string | null;
  model: string | null;
  permissionMode: string;
  effort: string | null;
  allowedTools: string[];
  disallowedTools: string[];
  paused: boolean;
  /** Equipe ("CLT") e cargo, quando o agente faz parte de uma. */
  team: string | null;
  slug: string | null;
  roleTitle: string | null;
  description: string | null;
  dailyTokenLimit: number | null;
  monthlyTokenLimit: number | null;
  hasSession: boolean;
  /** Estado real derivado das tarefas — a animação 3D só representa isto. */
  state: AgentState;
  currentTask: { id: string; prompt: string; status: TaskStatus; startedAt: string | null } | null;
  /** Última atividade real (ferramenta/mensagem) da tarefa atual. */
  activity: string | null;
  queued: number;
  approval: { id: string; taskId: string; tool: string; detail: string } | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  position: number;
}

const DONE_FLASH_MS = 8_000;
const ERROR_VISIBLE_MS = 30 * 60_000;

export async function listRoomAgents(now: Date = new Date()): Promise<RoomAgentView[]> {
  const agents = await prisma.agentProfile.findMany({ where: { archivedAt: null }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
  if (agents.length === 0) return [];
  const ids = agents.map((a) => a.id);
  const [active, queuedCounts, approvals, lastFinished] = await Promise.all([
    prisma.agentTask.findMany({ where: { agentId: { in: ids }, status: { in: [...ACTIVE] } }, orderBy: { createdAt: "asc" } }),
    prisma.agentTask.groupBy({ by: ["agentId"], where: { agentId: { in: ids }, status: "QUEUED" }, _count: { _all: true } }),
    prisma.agentTaskApproval.findMany({ where: { status: "PENDING", task: { agentId: { in: ids } } }, orderBy: { createdAt: "asc" }, include: { task: { select: { agentId: true } } } }),
    prisma.agentTask.findMany({ where: { agentId: { in: ids }, status: { in: [...TERMINAL] } }, orderBy: { finishedAt: "desc" }, distinct: ["agentId"] }),
  ]);
  const lastEvents = active.length
    ? await prisma.agentTaskEvent.findMany({ where: { taskId: { in: active.map((t) => t.id) }, kind: { in: ["tool_use", "assistant_text", "approval_requested"] } }, orderBy: { seq: "desc" }, distinct: ["taskId"] })
    : [];

  return agents.map((a) => {
    const task = active.find((t) => t.agentId === a.id) ?? null;
    const approval = approvals.find((p) => p.task.agentId === a.id) ?? null;
    const finished = lastFinished.find((t) => t.agentId === a.id) ?? null;
    const ev = task ? lastEvents.find((e) => e.taskId === task.id) : null;
    let state: AgentState = "AVAILABLE";
    if (task?.status === "WAITING_APPROVAL" || approval) state = "WAITING";
    else if (task?.status === "STARTING") state = "RECEIVING";
    else if (task?.status === "RUNNING") state = "RUNNING";
    else if (a.paused) state = "PAUSED";
    else if (finished && (finished.status === "FAILED" || finished.status === "INTERRUPTED") && finished.finishedAt && now.getTime() - finished.finishedAt.getTime() < ERROR_VISIBLE_MS) state = "ERROR";
    else if (finished?.status === "COMPLETED" && finished.finishedAt && now.getTime() - finished.finishedAt.getTime() < DONE_FLASH_MS) state = "DONE";
    return {
      id: a.id,
      name: a.name,
      specialty: a.specialty,
      cwd: a.cwd,
      projectId: a.projectId,
      model: a.model,
      permissionMode: a.permissionMode,
      effort: a.effort,
      team: a.team,
      slug: a.slug,
      roleTitle: a.roleTitle,
      description: a.description,
      dailyTokenLimit: a.dailyTokenLimit,
      monthlyTokenLimit: a.monthlyTokenLimit,
      allowedTools: a.allowedTools,
      disallowedTools: a.disallowedTools,
      paused: a.paused,
      hasSession: !!a.claudeSessionId,
      state,
      currentTask: task ? { id: task.id, prompt: task.prompt.slice(0, 160), status: task.status as TaskStatus, startedAt: task.startedAt?.toISOString() ?? null } : null,
      activity: ev?.text ? (ev.tool ? `${ev.tool} · ${ev.text}` : ev.text).slice(0, 140) : null,
      queued: queuedCounts.find((q) => q.agentId === a.id)?._count._all ?? 0,
      approval: approval ? { id: approval.id, taskId: approval.taskId, tool: approval.tool, detail: approval.detail } : null,
      lastFinishedAt: finished?.finishedAt?.toISOString() ?? null,
      lastError: state === "ERROR" ? (finished?.error ?? a.lastError) : null,
      position: a.position,
    };
  });
}

export async function purgeOldTasks(now: Date = new Date(), days = 60): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const old = await prisma.agentTask.findMany({ where: { status: { in: [...TERMINAL] }, finishedAt: { lt: cutoff } }, select: { id: true } });
  if (old.length > 0) await purgeAttachments({ taskIds: old.map((t) => t.id) }).catch(() => undefined);
  const r = await prisma.agentTask.deleteMany({ where: { status: { in: [...TERMINAL] }, finishedAt: { lt: cutoff } } });
  await purgeAttachments().catch(() => undefined); // uploads que nunca viraram comando (>24 h)
  return r.count;
}

// ---------------------------------------------------------------------------
// Repositórios extras do agente
// ---------------------------------------------------------------------------

const MAX_EXTRA_REPOS = 6;

export interface AgentReposView {
  primary: { fullName: string; branch: string | null; source: "agent" | "project" } | null;
  extras: Array<{ id: string; fullName: string; dir: string; branch: string | null }>;
}

export async function getAgentRepos(agentId: string): Promise<AgentReposView> {
  const agent = await prisma.agentProfile.findUnique({ where: { id: agentId } });
  if (!agent || agent.archivedAt) throw new NotFoundError("Agente não encontrado.");
  const { pickAgentRepository } = await import("./repo-link");
  const picked = await pickAgentRepository(agent);
  const extras = await listExtraRepos(agentId);
  return {
    primary: picked ? { fullName: picked.gh.fullName, branch: picked.branch ?? picked.gh.defaultBranch, source: picked.source } : null,
    extras: extras.map((e) => ({ id: e.id, fullName: e.githubRepository.fullName, dir: e.dir, branch: e.branch })),
  };
}

/** Liga um repositório EXTRA ao agente (ele passa a enxergar vários). `applyToAll` repete para todos os agentes ativos (ex.: o cérebro). */
export async function addExtraRepo(agentId: string, input: unknown, actor: Actor): Promise<{ added: number; message: string }> {
  const parsed = z.object({ githubRepositoryId: z.string().min(1).max(40), branch: z.string().trim().max(120).regex(/^[A-Za-z0-9._\/-]*$/, "Branch inválida.").optional().nullable(), applyToAll: z.boolean().optional() }).safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const repo = await prisma.gitHubRepository.findUnique({ where: { id: parsed.data.githubRepositoryId }, include: { installation: true } });
  if (!repo || repo.archived || repo.installation.status !== "ACTIVE") throw new ValidationError("Repositório não encontrado ou sem acesso do GitHub App.");
  const targets = parsed.data.applyToAll ? await prisma.agentProfile.findMany({ where: { archivedAt: null } }) : [await prisma.agentProfile.findUnique({ where: { id: agentId } })];
  let added = 0;
  const notes: string[] = [];
  for (const agent of targets) {
    if (!agent || agent.archivedAt) {
      if (!parsed.data.applyToAll) throw new NotFoundError("Agente não encontrado.");
      continue;
    }
    if (agent.githubRepositoryId === repo.id) {
      if (!parsed.data.applyToAll) throw new ValidationError("Este já é o repositório principal do agente.");
      continue;
    }
    const exists = await prisma.agentRepository.findUnique({ where: { agentId_githubRepositoryId: { agentId: agent.id, githubRepositoryId: repo.id } } });
    if (exists) {
      if (!parsed.data.applyToAll) throw new ValidationError("Este repositório já está conectado ao agente.");
      continue;
    }
    if ((await prisma.agentRepository.count({ where: { agentId: agent.id } })) >= MAX_EXTRA_REPOS) {
      if (!parsed.data.applyToAll) throw new ValidationError(`Limite de ${MAX_EXTRA_REPOS} repositórios extras por agente.`);
      continue;
    }
    await prisma.agentRepository.create({ data: { agentId: agent.id, githubRepositoryId: repo.id, branch: parsed.data.branch || null, dir: await freeExtraDir(agent.id, repo.name) } });
    await recordAuditEvent({ userId: actor.userId, action: "AGENT_PROFILE_UPDATED", status: "SUCCESS", entityType: "AgentProfile", entityId: agent.id, metadata: { addExtraRepo: repo.fullName }, ipAddress: actor.ip, userAgent: actor.userAgent });
    added += 1;
    // Clona já (só o do agente pedido, para não segurar a resposta com N clones).
    if (agent.id === agentId) notes.push((await Promise.race([prepareExtrasNow(agent.id), new Promise<string>((r) => setTimeout(() => r("Baixando em segundo plano…"), 90_000))])) || "Pronto.");
    else void prepareExtrasNow(agent.id).catch(() => undefined);
    orchestratorBus.emit({ type: "agent", agentId: agent.id });
  }
  return { added, message: notes.join(" ") || (added > 0 ? "Conectado. O código é baixado antes da próxima tarefa." : "Nada novo para conectar.") };
}

export async function removeExtraRepo(agentId: string, extraId: string, actor: Actor): Promise<{ cleanup: { removed: boolean; reason?: string } }> {
  const row = await prisma.agentRepository.findFirst({ where: { id: extraId, agentId }, include: { githubRepository: true } });
  if (!row) throw new NotFoundError("Repositório não encontrado neste agente.");
  // Apaga a cópia só se estiver tudo enviado (cleanupWorkspace confere); o vínculo sai de qualquer jeito.
  const { cleanupWorkspace } = await import("./git/ops");
  const cleanup = await cleanupWorkspace(agentId, { actorUserId: actor.userId, repo: row.id }).catch((e) => ({ removed: false, reason: e instanceof Error ? e.message : "Não consegui limpar a cópia." }));
  await prisma.agentRepository.delete({ where: { id: row.id } });
  await recordAuditEvent({ userId: actor.userId, action: "AGENT_PROFILE_UPDATED", status: "SUCCESS", entityType: "AgentProfile", entityId: agentId, metadata: { removeExtraRepo: row.githubRepository.fullName }, ipAddress: actor.ip, userAgent: actor.userAgent });
  orchestratorBus.emit({ type: "agent", agentId });
  return { cleanup };
}
