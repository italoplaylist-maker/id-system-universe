import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { recordAuditEvent } from "@/server/audit/audit-log";
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
  // Trocar o diretório invalida a sessão (ela pertence ao projeto anterior).
  const resetSession = data.cwd !== undefined && data.cwd !== existing.cwd;
  const agent = await prisma.agentProfile.update({
    where: { id },
    data: { ...data, ...(data.specialty !== undefined ? { specialty: data.specialty || null } : {}), ...(data.model !== undefined ? { model: data.model || null } : {}), ...(data.effort !== undefined ? { effort: data.effort || null } : {}), ...(resetSession ? { claudeSessionId: null } : {}) },
  });
  await recordAuditEvent({ userId: actor.userId, action: "AGENT_PROFILE_UPDATED", status: "SUCCESS", entityType: "AgentProfile", entityId: id, ipAddress: actor.ip, userAgent: actor.userAgent });
  orchestratorBus.emit({ type: "agent", agentId: id });
  return agent;
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
  return { maxConcurrent: row.maxConcurrent };
}

export async function updateSettings(input: unknown, actor: Actor) {
  const parsed = z.object({ maxConcurrent: z.number().int().min(1).max(16) }).safeParse(input);
  if (!parsed.success) throw new ValidationError("O limite de execuções simultâneas deve estar entre 1 e 16.");
  await prisma.orchestratorSetting.upsert({ where: { id: "default" }, create: { id: "default", maxConcurrent: parsed.data.maxConcurrent }, update: { maxConcurrent: parsed.data.maxConcurrent } });
  await recordAuditEvent({ userId: actor.userId, action: "ORCHESTRATOR_SETTINGS_UPDATED", status: "SUCCESS", entityType: "OrchestratorSetting", entityId: "default", metadata: { maxConcurrent: parsed.data.maxConcurrent }, ipAddress: actor.ip, userAgent: actor.userAgent });
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
