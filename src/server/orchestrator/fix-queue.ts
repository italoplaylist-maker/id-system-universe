import { prisma } from "@/server/db/client";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAuditEvent } from "@/server/audit/audit-log";
import { HUMAN_CATEGORY, FIX_KEY_PREFIX, sortHumanActions, type HumanActionKind, buildFindingBrief, buildFixBrief, fixIdempotencyKey, fixState, parseItemId, type FixState } from "@/lib/fix-queue";
import { agentBudget } from "./budget";
import { submitSystemTask } from "./service";

const ACTIVE = ["QUEUED", "STARTING", "RUNNING", "WAITING_APPROVAL"] as const;
const WINDOW_HOURS = 24 * 7;
const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export interface FixItemView {
  /** "erro:<id>" (veio dos logs) ou "achado:<id>" (registrado por um agente). */
  id: string;
  kind: "erro" | "achado";
  title: string;
  application: string | null;
  project: string | null;
  /** Só nos achados. */
  severity: string | null;
  category: string | null;
  reportedBy: string | null;
  count: number;
  lastSeenAt: string;
  detail: string;
  state: FixState;
  taskId: string | null;
}

export interface HumanActionView {
  id: string;
  kind: HumanActionKind;
  title: string;
  detail: string;
  /** Link externo (PR no GitHub). */
  url: string | null;
  /** "achado:<id>" quando dá para marcar como feito aqui. */
  itemId: string | null;
  at: string;
}

export interface FixQueueView {
  /** Tudo que espera o Italo, em ordem de prioridade (merge, autorização, incidente, ação manual). */
  actions: HumanActionView[];
  items: FixItemView[];
  /** Há uma correção em andamento: só uma por vez. */
  busy: boolean;
}

async function activeFixTaskIds(): Promise<Set<string>> {
  const rows = await prisma.agentTask.findMany({ where: { idempotencyKey: { startsWith: FIX_KEY_PREFIX }, status: { in: [...ACTIVE] } }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

/** O que só o Italo resolve: PRs aguardando merge, tarefas aguardando autorização, incidentes escalados e ações manuais registradas pelos agentes. */
async function listHumanActions(): Promise<HumanActionView[]> {
  const [prs, waiting, incidents, manual] = await Promise.all([
    prisma.agentPullRequest.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "asc" }, take: 30, include: { agent: { select: { name: true } } } }),
    prisma.agentTask.findMany({ where: { status: "WAITING_APPROVAL" }, orderBy: { createdAt: "asc" }, take: 20, include: { agent: { select: { name: true } } } }),
    prisma.deployIncident.findMany({ where: { status: "ESCALATED" }, orderBy: { createdAt: "asc" }, take: 10, include: { application: { select: { name: true } } } }),
    prisma.agentFinding.findMany({ where: { category: HUMAN_CATEGORY }, orderBy: { updatedAt: "asc" }, take: 40 }),
  ]);
  const manualOpen = manual.filter((f) => fixState({ lastSeenAt: f.updatedAt, fixSentAt: f.fixSentAt, dismissedAt: f.dismissedAt, taskActive: false }) === "pending");
  return sortHumanActions<HumanActionView>([
    ...prs.map((p): HumanActionView => ({ id: `merge:${p.id}`, kind: "merge", title: `PR #${p.number} — ${p.title}`, detail: `${p.repo} · aberto por ${p.agent.name}. Revise e faça o merge.`, url: p.url, itemId: null, at: p.createdAt.toISOString() })),
    ...waiting.map((t): HumanActionView => ({ id: `aprovacao:${t.id}`, kind: "aprovacao", title: `${t.agent.name} aguarda sua autorização`, detail: t.prompt.replace(/\s+/g, " ").slice(0, 240), url: null, itemId: null, at: t.createdAt.toISOString() })),
    ...incidents.map((i): HumanActionView => ({ id: `incidente:${i.id}`, kind: "incidente", title: `Deploy de ${i.application.name} segue falhando`, detail: `A equipe tentou ${i.attempts}× ou passou do prazo. O agente culpado continua bloqueado até você decidir (aba Operação).`, url: null, itemId: null, at: i.createdAt.toISOString() })),
    ...manualOpen.map((f): HumanActionView => ({ id: `acao:${f.id}`, kind: "acao", title: f.title, detail: `${f.detail}\n— registrado por ${f.agentName}${f.applicationName ? ` · ${f.applicationName}` : ""}`, url: null, itemId: `achado:${f.id}`, at: f.updatedAt.toISOString() })),
  ]);
}

/** Tudo que a equipe viu e pode melhorar: erros dos logs + achados registrados pelos agentes, com o estado de cada um. */
export async function listFixQueue(now: Date = new Date()): Promise<FixQueueView> {
  const since = new Date(now.getTime() - WINDOW_HOURS * 3600_000);
  const [errors, findings, active, actions] = await Promise.all([
    prisma.errorGroup.findMany({ where: { lastSeenAt: { gte: since } }, include: { application: { select: { name: true, project: { select: { name: true } } } } }, orderBy: [{ lastSeenAt: "desc" }, { count: "desc" }], take: 40 }),
    prisma.agentFinding.findMany({ where: { category: { not: HUMAN_CATEGORY }, updatedAt: { gte: new Date(now.getTime() - 30 * 24 * 3600_000) } }, orderBy: { updatedAt: "desc" }, take: 60 }),
    activeFixTaskIds(),
    listHumanActions(),
  ]);
  const isActive = (id: string | null) => id !== null && active.has(id);
  const items: FixItemView[] = [
    ...errors.map((r): FixItemView => ({
      id: `erro:${r.id}`, kind: "erro", title: r.sample.split("\n")[0].slice(0, 200), application: r.application.name, project: r.application.project?.name ?? null,
      severity: null, category: null, reportedBy: "Logs dos sistemas", count: r.count, lastSeenAt: r.lastSeenAt.toISOString(), detail: r.sample,
      state: fixState({ lastSeenAt: r.lastSeenAt, fixSentAt: r.fixSentAt, dismissedAt: r.dismissedAt, taskActive: isActive(r.fixTaskId) }), taskId: r.fixTaskId,
    })),
    ...findings.map((f): FixItemView => ({
      id: `achado:${f.id}`, kind: "achado", title: f.title, application: f.applicationName, project: null,
      severity: f.severity, category: f.category, reportedBy: f.agentName, count: 1, lastSeenAt: f.updatedAt.toISOString(), detail: f.detail,
      state: fixState({ lastSeenAt: f.updatedAt, fixSentAt: f.fixSentAt, dismissedAt: f.dismissedAt, taskActive: isActive(f.fixTaskId) }), taskId: f.fixTaskId,
    })),
  ];
  const order: Record<FixState, number> = { fixing: 0, pending: 1, sent: 2, dismissed: 3 };
  items.sort((a, b) => order[a.state] - order[b.state] || (SEVERITY_ORDER[a.severity ?? "MEDIUM"] ?? 2) - (SEVERITY_ORDER[b.severity ?? "MEDIUM"] ?? 2) || b.lastSeenAt.localeCompare(a.lastSeenAt));
  return { actions, items, busy: active.size > 0 };
}

type Actor = { userId: string; ip?: string; userAgent?: string };

/** Manda UM item (erro ou achado) para o ID Manager corrigir. Recusa se já há uma correção em andamento. */
export async function sendToFix(itemId: string, actor: Actor, now: Date = new Date()): Promise<FixQueueView> {
  const ref = parseItemId(itemId);
  if (!ref) throw new ValidationError("Item inválido.");
  let brief: string;
  if (ref.kind === "erro") {
    const g = await prisma.errorGroup.findUnique({ where: { id: ref.rawId }, include: { application: { select: { name: true, project: { select: { name: true } } } } } });
    if (!g) throw new NotFoundError("Erro não encontrado.");
    brief = buildFixBrief({ application: g.application.name, project: g.application.project?.name ?? null, count: g.count, firstSeenAt: g.firstSeenAt.toISOString(), lastSeenAt: g.lastSeenAt.toISOString(), sample: g.sample });
  } else {
    const f = await prisma.agentFinding.findUnique({ where: { id: ref.rawId } });
    if (!f) throw new NotFoundError("Achado não encontrado.");
    brief = buildFindingBrief({ title: f.title, detail: f.detail, severity: f.severity, category: f.category, application: f.applicationName, reportedBy: f.agentName });
  }
  if ((await activeFixTaskIds()).size > 0) throw new ConflictError("O ID Manager já está corrigindo outro item. Espere terminar: é um de cada vez.");
  const manager = await prisma.agentProfile.findFirst({ where: { team: "CLT", slug: "id-manager", archivedAt: null }, select: { id: true, dailyTokenLimit: true, monthlyTokenLimit: true } });
  if (!manager) throw new ValidationError("A equipe CLT ainda não foi criada.");
  const budget = await agentBudget(manager.id, { dailyTokenLimit: manager.dailyTokenLimit, monthlyTokenLimit: manager.monthlyTokenLimit }, now);
  if (budget.blocked) throw new ConflictError(`O ID Manager está sem orçamento de tokens: ${budget.reason}`);
  const { task } = await submitSystemTask({ agentId: manager.id, prompt: brief, idempotencyKey: fixIdempotencyKey(`${ref.kind}-${ref.rawId}`, now), priority: 1 });
  const mark = { fixTaskId: task.id, fixSentAt: now };
  if (ref.kind === "erro") await prisma.errorGroup.update({ where: { id: ref.rawId }, data: mark });
  else await prisma.agentFinding.update({ where: { id: ref.rawId }, data: mark });
  await recordAuditEvent({ userId: actor.userId, action: "AGENT_TASK_SUBMITTED", status: "SUCCESS", entityType: ref.kind === "erro" ? "ErrorGroup" : "AgentFinding", entityId: ref.rawId, metadata: { event: "send_to_fix", taskId: task.id }, ipAddress: actor.ip, userAgent: actor.userAgent });
  return listFixQueue(now);
}

/** Descarta um item da fila (o humano decidiu que não precisa). Se o erro/achado voltar a ser registrado, ele reaparece. */
export async function dismissFix(itemId: string, actor: Actor, now: Date = new Date()): Promise<FixQueueView> {
  const ref = parseItemId(itemId);
  if (!ref) throw new ValidationError("Item inválido.");
  const exists = ref.kind === "erro" ? await prisma.errorGroup.findUnique({ where: { id: ref.rawId }, select: { id: true } }) : await prisma.agentFinding.findUnique({ where: { id: ref.rawId }, select: { id: true } });
  if (!exists) throw new NotFoundError("Item não encontrado.");
  if (ref.kind === "erro") await prisma.errorGroup.update({ where: { id: ref.rawId }, data: { dismissedAt: now } });
  else await prisma.agentFinding.update({ where: { id: ref.rawId }, data: { dismissedAt: now } });
  await recordAuditEvent({ userId: actor.userId, action: "AGENT_PROFILE_UPDATED", status: "SUCCESS", entityType: ref.kind === "erro" ? "ErrorGroup" : "AgentFinding", entityId: ref.rawId, metadata: { event: "dismiss_fix" }, ipAddress: actor.ip, userAgent: actor.userAgent });
  return listFixQueue(now);
}
