import { prisma } from "@/server/db/client";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAuditEvent } from "@/server/audit/audit-log";
import { FIX_KEY_PREFIX, buildFixBrief, fixIdempotencyKey, fixState, type FixState } from "@/lib/fix-queue";
import { agentBudget } from "./budget";
import { submitSystemTask } from "./service";

const ACTIVE = ["QUEUED", "STARTING", "RUNNING", "WAITING_APPROVAL"] as const;
const WINDOW_HOURS = 24 * 7;

export interface FixItemView {
  id: string;
  application: string;
  project: string | null;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  sample: string;
  state: FixState;
  taskId: string | null;
}

export interface FixQueueView {
  items: FixItemView[];
  /** Há uma correção em andamento: só uma por vez. */
  busy: boolean;
}

async function activeFixTaskIds(): Promise<Set<string>> {
  const rows = await prisma.agentTask.findMany({ where: { idempotencyKey: { startsWith: FIX_KEY_PREFIX }, status: { in: [...ACTIVE] } }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

/** Erros dos sistemas (7 dias) que os agentes viram, com o estado de cada um na fila de correção. */
export async function listFixQueue(now: Date = new Date()): Promise<FixQueueView> {
  const since = new Date(now.getTime() - WINDOW_HOURS * 3600_000);
  const [rows, active] = await Promise.all([
    prisma.errorGroup.findMany({
      where: { lastSeenAt: { gte: since } },
      include: { application: { select: { name: true, project: { select: { name: true } } } } },
      orderBy: [{ lastSeenAt: "desc" }, { count: "desc" }],
      take: 40,
    }),
    activeFixTaskIds(),
  ]);
  const items = rows.map((r): FixItemView => ({
    id: r.id,
    application: r.application.name,
    project: r.application.project?.name ?? null,
    count: r.count,
    firstSeenAt: r.firstSeenAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    sample: r.sample,
    state: fixState({ lastSeenAt: r.lastSeenAt, fixSentAt: r.fixSentAt, dismissedAt: r.dismissedAt, taskActive: r.fixTaskId !== null && active.has(r.fixTaskId) }),
    taskId: r.fixTaskId,
  }));
  const order: Record<FixState, number> = { fixing: 0, pending: 1, sent: 2, dismissed: 3 };
  items.sort((a, b) => order[a.state] - order[b.state]);
  return { items, busy: active.size > 0 };
}

type Actor = { userId: string; ip?: string; userAgent?: string };

/** Manda UM erro para o ID Manager corrigir. Recusa se já há uma correção em andamento. */
export async function sendToFix(groupId: string, actor: Actor, now: Date = new Date()): Promise<FixQueueView> {
  const group = await prisma.errorGroup.findUnique({ where: { id: groupId }, include: { application: { select: { name: true, project: { select: { name: true } } } } } });
  if (!group) throw new NotFoundError("Erro não encontrado.");
  if ((await activeFixTaskIds()).size > 0) throw new ConflictError("O ID Manager já está corrigindo outro erro. Espere terminar: é um de cada vez.");
  const manager = await prisma.agentProfile.findFirst({ where: { team: "CLT", slug: "id-manager", archivedAt: null }, select: { id: true, dailyTokenLimit: true, monthlyTokenLimit: true } });
  if (!manager) throw new ValidationError("A equipe CLT ainda não foi criada.");
  const budget = await agentBudget(manager.id, { dailyTokenLimit: manager.dailyTokenLimit, monthlyTokenLimit: manager.monthlyTokenLimit }, now);
  if (budget.blocked) throw new ConflictError(`O ID Manager está sem orçamento de tokens: ${budget.reason}`);
  const brief = buildFixBrief({ application: group.application.name, project: group.application.project?.name ?? null, count: group.count, firstSeenAt: group.firstSeenAt.toISOString(), lastSeenAt: group.lastSeenAt.toISOString(), sample: group.sample });
  const { task } = await submitSystemTask({ agentId: manager.id, prompt: brief, idempotencyKey: fixIdempotencyKey(group.id, now), priority: 1 });
  await prisma.errorGroup.update({ where: { id: group.id }, data: { fixTaskId: task.id, fixSentAt: now } });
  await recordAuditEvent({ userId: actor.userId, action: "AGENT_TASK_SUBMITTED", status: "SUCCESS", entityType: "ErrorGroup", entityId: group.id, metadata: { event: "send_to_fix", taskId: task.id }, ipAddress: actor.ip, userAgent: actor.userAgent });
  return listFixQueue(now);
}

/** Descarta um erro da fila (o humano decidiu que não precisa corrigir). Se o erro voltar a acontecer, ele reaparece. */
export async function dismissFix(groupId: string, actor: Actor, now: Date = new Date()): Promise<FixQueueView> {
  const group = await prisma.errorGroup.findUnique({ where: { id: groupId }, select: { id: true } });
  if (!group) throw new NotFoundError("Erro não encontrado.");
  await prisma.errorGroup.update({ where: { id: groupId }, data: { dismissedAt: now } });
  await recordAuditEvent({ userId: actor.userId, action: "AGENT_PROFILE_UPDATED", status: "SUCCESS", entityType: "ErrorGroup", entityId: groupId, metadata: { event: "dismiss_fix" }, ipAddress: actor.ip, userAgent: actor.userAgent });
  return listFixQueue(now);
}
