import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { recordAuditEvent } from "@/server/audit/audit-log";
import { redactSecrets } from "@/server/claude/agent-service";
import { orchestratorBus } from "./bus";
import { ExecutorStartError, getExecutor } from "./executor";
import { prepareForRun } from "./attachments";
import { buildUniverseMcp, UNIVERSE_AUTO_ALLOWED, UNIVERSE_MERGE_TOOL } from "./git/tools";
import { UNIVERSE_COMMERCIAL_TOOLS, UNIVERSE_TEAM_TOOLS } from "./tools-team";
import { notifyApprovalRequested, notifyTaskFinished } from "./notify";
import { loadMcpServersForRun } from "./tools-config";
import { seedDefaultPacks } from "./skill-packs";
import { seedGlobalClaudeMd } from "./tools-config";
import { cleanupStorage } from "./storage";
import { getWorkspacePreparer, loadExtraRepos, syncProjectAgents } from "./workspace";
import { budgetNote, cltDef, cltRoleNote } from "@/lib/clt-team";
import { commercialDef, commercialRoleNote } from "@/lib/commercial-team";
import { advanceCommercialCycle } from "./commercial";
import { agentBudget } from "./budget";
import { ACTIVE, appendEvent, getSettings, purgeOldTasks, setTaskRegisteredHook } from "./service";

/**
 * Worker do orquestrador. Roda no processo do servidor do Universe (instrumentation) e é o ÚNICO que
 * inicia execuções: a requisição HTTP só registra a tarefa e volta; aqui a tarefa é reivindicada de
 * forma atômica (QUEUED → STARTING), executada em background e acompanhada até o fim.
 */

const HEARTBEAT_MS = 10_000;

/** Com "sem pedir permissão" ligado: comandos, edições e web liberados. O merge continua passando pelas travas (CI verde, sem conflito, squash). */
const AUTO_APPROVE_TOOLS = ["Bash", "Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "Glob", "Grep", "WebFetch", "WebSearch", "Task", "TodoWrite"];
/** Mesmo liberado, nunca: apagar a raiz, sudo, push forçado (o agente também não tem credencial de Git). */
const AUTO_APPROVE_DENY = ["Bash(sudo:*)", "Bash(rm -rf /:*)", "Bash(rm -rf /*)", "Bash(rm -rf ~:*)", "Bash(git push --force:*)", "Bash(git push -f:*)"];
/** Sem batida por este tempo = o worker que a executava caiu. */
export const STALE_AFTER_MS = 45_000;
const APPROVAL_TIMEOUT_MS = 10 * 60_000;
const APPROVAL_POLL_MS = 800;

interface Live {
  abort: AbortController;
}

const g = globalThis as unknown as { __isuLive?: Map<string, Live>; __isuRuns?: Set<Promise<void>>; __isuDispatchP?: Promise<number> };
const live = (g.__isuLive ??= new Map<string, Live>());
const runs = (g.__isuRuns ??= new Set<Promise<void>>());

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });

/** Aguarda todas as execuções em andamento (testes e desligamento ordenado). */
export async function idle(): Promise<void> {
  while (runs.size > 0) await Promise.allSettled([...runs]);
}

export function isRunningHere(taskId: string): boolean {
  return live.has(taskId);
}

// ---------------------------------------------------------------------------
// Despacho: respeita 1 execução por agente e o limite global
// ---------------------------------------------------------------------------

export async function dispatch(): Promise<number> {
  // Já há um despacho em curso: espera ele terminar e faz a SUA passada em seguida (nenhuma vaga aberta no meio se perde,
  // e quem chama `await dispatch()` sabe que as tarefas elegíveis já foram reivindicadas quando a promessa resolve).
  while (g.__isuDispatchP) await g.__isuDispatchP.catch(() => undefined);
  const p = dispatchPass();
  g.__isuDispatchP = p;
  try {
    return await p;
  } finally {
    if (g.__isuDispatchP === p) g.__isuDispatchP = undefined;
  }
}

async function dispatchPass(): Promise<number> {
  let started = 0;
  const { maxConcurrent } = await getSettings();
  for (;;) {
    const [activeTasks, queued] = await Promise.all([
      prisma.agentTask.findMany({ where: { status: { in: [...ACTIVE] } }, select: { agentId: true } }),
      prisma.agentTask.findMany({ where: { status: "QUEUED", agent: { archivedAt: null, paused: false } }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }], take: 50, select: { id: true, agentId: true } }),
    ]);
    if (activeTasks.length >= maxConcurrent) break;
    const busy = new Set(activeTasks.map((t) => t.agentId));
    const next = queued.find((t) => !busy.has(t.agentId));
    if (!next) break;
    // Reivindicação atômica: só um worker transforma esta tarefa em STARTING.
    const claim = await prisma.agentTask.updateMany({ where: { id: next.id, status: "QUEUED" }, data: { status: "STARTING", startedAt: new Date(), heartbeatAt: new Date() } });
    if (claim.count !== 1) continue;
    orchestratorBus.emit({ type: "task", taskId: next.id, agentId: next.agentId });
    const run = runTask(next.id).catch((error) => logger.error("orchestrator_run_failed", { taskId: next.id, message: error instanceof Error ? error.message : String(error) }));
    const tracked = run.finally(() => runs.delete(tracked));
    runs.add(tracked);
    started += 1;
  }
  return started;
}

/** Chama o despacho sem esperar (logo após registrar uma tarefa). */
setTaskRegisteredHook(() => kick());

export function kick(): void {
  const p = dispatch()
    .then(() => undefined)
    .catch((error) => logger.error("orchestrator_dispatch_failed", { message: error instanceof Error ? error.message : String(error) }));
  const tracked = p.finally(() => runs.delete(tracked));
  runs.add(tracked);
}

// ---------------------------------------------------------------------------
// Execução de uma tarefa
// ---------------------------------------------------------------------------

async function runTask(taskId: string): Promise<void> {
  const task = await prisma.agentTask.findUnique({ where: { id: taskId }, include: { agent: true } });
  if (!task) return;
  const agent = task.agent;
  // Orçamento de tokens: estourou o limite diário/mensal deste agente, a execução nem começa (nenhum token é gasto).
  const budget = await agentBudget(agent.id, { dailyTokenLimit: agent.dailyTokenLimit, monthlyTokenLimit: agent.monthlyTokenLimit });
  if (budget.blocked) {
    const reason = `${budget.reason} Ajuste o limite do agente ou espere a janela renovar.`;
    await finish(taskId, agent.id, "FAILED", { error: reason });
    await appendEvent(taskId, "failed", reason);
    return;
  }
  const abort = new AbortController();
  live.set(taskId, { abort });
  const beat = setInterval(() => {
    prisma.agentTask.updateMany({ where: { id: taskId, status: { in: [...ACTIVE] } }, data: { heartbeatAt: new Date() } }).catch(() => undefined);
  }, HEARTBEAT_MS);
  // Cancelamento pedido pelo painel chega por flag no banco (vale também entre instâncias).
  const cancelWatch = setInterval(() => {
    prisma.agentTask.findUnique({ where: { id: taskId }, select: { cancelRequested: true } }).then((t) => {
      if (t?.cancelRequested) abort.abort();
    }).catch(() => undefined);
  }, 1_000);

  let started = false;
  const markStarted = async (info: { sessionId?: string; model?: string }) => {
    if (started) return;
    started = true;
    // "EXECUTANDO" só depois de o Claude ter iniciado de verdade (primeira mensagem do SDK).
    await prisma.agentTask.updateMany({ where: { id: taskId, status: "STARTING" }, data: { status: "RUNNING", claudeSessionId: info.sessionId ?? undefined } });
    if (info.sessionId && info.sessionId !== agent.claudeSessionId) await prisma.agentProfile.update({ where: { id: agent.id }, data: { claudeSessionId: info.sessionId } });
    await appendEvent(taskId, "started", info.model ? `Claude iniciou (${info.model})` : "Claude iniciou");
    orchestratorBus.emit({ type: "task", taskId, agentId: agent.id });
  };

  const requestApproval = async (tool: string, input: Record<string, unknown>) => {
    let detail = redactSecrets(describeInput(input)).slice(0, 500);
    if (tool === UNIVERSE_MERGE_TOOL) {
      const pr = await prisma.agentPullRequest.findFirst({ where: { agentId: agent.id, status: "OPEN", ...(typeof input.number === "number" ? { number: input.number } : {}) }, orderBy: { createdAt: "desc" } });
      detail = pr ? `Merge (squash) do PR #${pr.number} "${pr.title}" em ${pr.repo} → vai para produção` : "Merge do PR aberto mais recente";
    }
    const approval = await prisma.agentTaskApproval.create({ data: { taskId, tool, detail } });
    await prisma.agentTask.updateMany({ where: { id: taskId, status: { in: ["RUNNING", "STARTING"] } }, data: { status: "WAITING_APPROVAL" } });
    await appendEvent(taskId, "approval_requested", detail, tool);
    void notifyApprovalRequested(taskId, tool, detail).catch(() => undefined);
    orchestratorBus.emit({ type: "approval", taskId, agentId: agent.id });
    const deadline = Date.now() + APPROVAL_TIMEOUT_MS;
    let status = "PENDING";
    while (status === "PENDING" && Date.now() < deadline && !abort.signal.aborted) {
      await sleep(APPROVAL_POLL_MS, abort.signal);
      status = (await prisma.agentTaskApproval.findUnique({ where: { id: approval.id }, select: { status: true } }))?.status ?? "EXPIRED";
    }
    if (status === "PENDING") {
      await prisma.agentTaskApproval.updateMany({ where: { id: approval.id, status: "PENDING" }, data: { status: "EXPIRED", decidedAt: new Date() } });
      status = "EXPIRED";
    }
    await prisma.agentTask.updateMany({ where: { id: taskId, status: "WAITING_APPROVAL" }, data: { status: "RUNNING" } });
    await appendEvent(taskId, "approval_decided", status === "APPROVED" ? "Aprovado" : status === "DENIED" ? "Negado" : "Sem resposta — negado", tool);
    orchestratorBus.emit({ type: "approval", taskId, agentId: agent.id });
    return status === "APPROVED" ? { allow: true } : { allow: false, message: status === "DENIED" ? "Negado por você no ID System Universe." : "Sem decisão no ID System Universe a tempo." };
  };

  const prepared = await prepareForRun(taskId).catch(() => ({ attachments: [], dir: null as string | null }));
  const configured = await loadMcpServersForRun().catch(() => ({}));
  // Ferramentas do Universe (PR/merge/limpeza): o agente não tem credencial de Git, só estas ferramentas.
  const universe = await buildUniverseMcp(agent.id, taskId).catch(() => null);
  const mcpServers: Record<string, unknown> = { ...configured, ...(universe ? { universe } : {}) };
  const { autoApprove } = await getSettings();
  // Equipe CLT: o agente sabe quanto já gastou e se administra (nota no início da execução).
  const cltBudgetNote =
    agent.team === "CLT" || agent.team === "COMERCIAL"
      ? await agentBudget(agent.id, { dailyTokenLimit: agent.dailyTokenLimit, monthlyTokenLimit: agent.monthlyTokenLimit })
          .then((b) => budgetNote({ usedDay: b.usedDay, usedMonth: b.usedMonth, dailyLimit: agent.dailyTokenLimit, monthlyLimit: agent.monthlyTokenLimit }))
          .catch(() => "")
      : "";
  // Repositórios extras já clonados (preenchido depois que o workspace é preparado, logo abaixo).
  let extraRepos: Array<{ dir: string; fullName: string; name: string }> = [];
  const input = (resume: string | null | undefined) => ({
    taskId,
    prompt: task.prompt,
    cwd: agent.cwd,
    model: agent.model,
    permissionMode: (agent.permissionMode === "plan" ? "plan" : agent.permissionMode === "acceptEdits" || autoApprove ? "acceptEdits" : "default") as "default" | "acceptEdits" | "plan",
    agentName: agent.name,
    specialty: agent.specialty,
    roleNote: agent.team === "COMERCIAL" ? commercialRoleNote({ name: agent.name, roleTitle: agent.roleTitle || commercialDef(agent.slug ?? "")?.roleTitle || "Funcionário", description: agent.description || commercialDef(agent.slug ?? "")?.description || "" }) + cltBudgetNote : agent.team === "CLT" ? cltRoleNote({ name: agent.name, roleTitle: agent.roleTitle || cltDef(agent.slug ?? "")?.roleTitle || "Funcionário", description: agent.description || cltDef(agent.slug ?? "")?.description || "" }) + cltBudgetNote : undefined,
    effort: agent.effort,
    attachments: prepared.attachments,
    attachmentsDir: prepared.dir,
    extraRepos,
    allowedTools: [...new Set([...agent.allowedTools, ...(universe && agent.team !== "COMERCIAL" ? UNIVERSE_AUTO_ALLOWED : []), ...(universe && agent.team === "CLT" ? UNIVERSE_TEAM_TOOLS : []), ...(universe && agent.team === "COMERCIAL" ? UNIVERSE_COMMERCIAL_TOOLS : []), ...(autoApprove && agent.team !== "COMERCIAL" ? [...AUTO_APPROVE_TOOLS, ...(universe ? [UNIVERSE_MERGE_TOOL] : [])] : [])])],
    disallowedTools: [...new Set([...agent.disallowedTools, ...(autoApprove ? AUTO_APPROVE_DENY : [])])],
    mcpServers,
    resumeSessionId: resume,
    signal: abort.signal,
    canUseTool: requestApproval,
    onStarted: markStarted,
    onText: (text: string) => appendEvent(taskId, "assistant_text", text),
    onToolUse: (tool: string, summary: string) => appendEvent(taskId, "tool_use", summary, tool),
    onToolResult: (summary: string, isError: boolean) => appendEvent(taskId, isError ? "tool_error" : "tool_result", summary),
  });

  try {
    // Antes do Claude iniciar (ainda "INICIANDO"): garante o diretório do agente (clone do GitHub vinculado, se faltar).
    await getWorkspacePreparer()(agent, (text) => appendEvent(taskId, "info", text));
    extraRepos = await loadExtraRepos(agent.id, agent.cwd).catch(() => []);
    let outcome;
    try {
      outcome = await getExecutor().run(input(agent.claudeSessionId));
    } catch (error) {
      // A sessão salva sumiu (ex.: disco do servidor recriado) e NADA foi executado: recomeça uma sessão nova, uma única vez.
      if (error instanceof ExecutorStartError && agent.claudeSessionId && !abort.signal.aborted) {
        await appendEvent(taskId, "info", "A sessão anterior do agente não está mais disponível no servidor — iniciando uma nova sessão.");
        await prisma.agentProfile.update({ where: { id: agent.id }, data: { claudeSessionId: null } });
        outcome = await getExecutor().run(input(null));
      } else throw error;
    }
    const fresh = await prisma.agentTask.findUnique({ where: { id: taskId }, select: { cancelRequested: true } });
    if (fresh?.cancelRequested || abort.signal.aborted) {
      await finish(taskId, agent.id, "CANCELLED", { error: "Cancelada." });
      await appendEvent(taskId, "cancelled", "Execução cancelada");
    } else {
      await finish(taskId, agent.id, "COMPLETED", { result: outcome.result?.slice(0, 20000) ?? null, costUsd: outcome.costUsd ?? null, turns: outcome.turns ?? null, inputTokens: outcome.inputTokens ?? null, outputTokens: outcome.outputTokens ?? null, cacheTokens: outcome.cacheTokens ?? null, claudeSessionId: outcome.sessionId });
      await appendEvent(taskId, "completed", outcome.result?.slice(0, 1500) ?? "Concluída");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cancelled = abort.signal.aborted || (await prisma.agentTask.findUnique({ where: { id: taskId }, select: { cancelRequested: true } }))?.cancelRequested;
    if (cancelled) {
      await finish(taskId, agent.id, "CANCELLED", { error: "Cancelada." });
      await appendEvent(taskId, "cancelled", "Execução cancelada");
    } else {
      await finish(taskId, agent.id, "FAILED", { error: message.slice(0, 2000) });
      await prisma.agentProfile.update({ where: { id: agent.id }, data: { lastError: message.slice(0, 500) } }).catch(() => undefined);
      await appendEvent(taskId, "failed", message.slice(0, 2000));
    }
  } finally {
    clearInterval(beat);
    clearInterval(cancelWatch);
    live.delete(taskId);
    // O agente ficou livre: a próxima tarefa da fila começa sozinha.
    kick();
  }
}

async function finish(taskId: string, agentId: string, status: "COMPLETED" | "FAILED" | "CANCELLED", data: { result?: string | null; error?: string | null; costUsd?: number | null; turns?: number | null; inputTokens?: number | null; outputTokens?: number | null; cacheTokens?: number | null; claudeSessionId?: string }) {
  const won = await prisma.agentTask.updateMany({
    where: { id: taskId, status: { in: [...ACTIVE] } },
    data: { status, finishedAt: new Date(), result: data.result ?? undefined, error: data.error ?? undefined, costUsd: data.costUsd ?? undefined, turns: data.turns ?? undefined, inputTokens: data.inputTokens ?? undefined, outputTokens: data.outputTokens ?? undefined, cacheTokens: data.cacheTokens ?? undefined, claudeSessionId: data.claudeSessionId ?? undefined },
  });
  if (won.count === 1 && status !== "CANCELLED") void notifyTaskFinished(taskId, status).catch(() => undefined);
  if (won.count === 1) void advanceCommercialCycle(taskId, status).catch(() => undefined);
  await prisma.agentProfile.update({ where: { id: agentId }, data: { lastActiveAt: new Date(), ...(status === "COMPLETED" ? { lastError: null } : {}), ...(data.claudeSessionId ? { claudeSessionId: data.claudeSessionId } : {}) } }).catch(() => undefined);
  orchestratorBus.emit({ type: "task", taskId, agentId });
}

function describeInput(input: Record<string, unknown>): string {
  for (const key of ["command", "file_path", "path", "url", "pattern", "query", "description"]) {
    if (typeof input[key] === "string") return (input[key] as string).replace(/\s+/g, " ");
  }
  try {
    return JSON.stringify(input).slice(0, 400);
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Cancelamento
// ---------------------------------------------------------------------------

export async function cancelTask(taskId: string, actor: { userId: string; ip?: string; userAgent?: string }): Promise<{ status: string }> {
  const task = await prisma.agentTask.findUnique({ where: { id: taskId } });
  if (!task) throw new NotFoundError("Tarefa não encontrada.");
  if (["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(task.status)) throw new ValidationError("Esta tarefa já terminou.");
  await recordAuditEvent({ userId: actor.userId, action: "AGENT_TASK_CANCELLED", status: "SUCCESS", entityType: "AgentTask", entityId: taskId, ipAddress: actor.ip, userAgent: actor.userAgent });
  if (task.status === "QUEUED") {
    const won = await prisma.agentTask.updateMany({ where: { id: taskId, status: "QUEUED" }, data: { status: "CANCELLED", finishedAt: new Date(), error: "Cancelada na fila." } });
    if (won.count === 1) {
      await appendEvent(taskId, "cancelled", "Cancelada antes de começar");
      orchestratorBus.emit({ type: "task", taskId, agentId: task.agentId });
      return { status: "CANCELLED" };
    }
  }
  // Em execução: sinaliza (a flag vale mesmo que o executor esteja em outra instância) e aborta aqui se for este processo.
  await prisma.agentTask.update({ where: { id: taskId }, data: { cancelRequested: true } });
  live.get(taskId)?.abort.abort();
  await appendEvent(taskId, "info", "Cancelamento solicitado");
  orchestratorBus.emit({ type: "task", taskId, agentId: task.agentId });
  return { status: "CANCELLING" };
}

// ---------------------------------------------------------------------------
// Recuperação: tarefas cujo worker caiu
// ---------------------------------------------------------------------------

/**
 * Tarefa em execução sem batida do coração (e que não é deste processo) foi interrompida por reinício/queda.
 * Não é repetida sozinha — só o usuário decide reenviar, já que parte do trabalho pode ter sido feita.
 */
export async function recoverStale(now: Date = new Date(), staleMs = STALE_AFTER_MS): Promise<number> {
  const cutoff = new Date(now.getTime() - staleMs);
  const stale = await prisma.agentTask.findMany({ where: { status: { in: [...ACTIVE] }, OR: [{ heartbeatAt: { lt: cutoff } }, { heartbeatAt: null, startedAt: { lt: cutoff } }] }, select: { id: true, agentId: true } });
  let n = 0;
  for (const t of stale) {
    if (live.has(t.id)) continue;
    const won = await prisma.agentTask.updateMany({ where: { id: t.id, status: { in: [...ACTIVE] } }, data: { status: "INTERRUPTED", finishedAt: new Date(), error: "O servidor reiniciou durante a execução. Revise o que já foi feito antes de reenviar." } });
    if (won.count === 1) {
      await prisma.agentTaskApproval.updateMany({ where: { taskId: t.id, status: "PENDING" }, data: { status: "EXPIRED", decidedAt: new Date() } });
      await appendEvent(t.id, "interrupted", "Execução interrompida: o worker deixou de responder.");
      orchestratorBus.emit({ type: "task", taskId: t.id, agentId: t.agentId });
      void notifyTaskFinished(t.id, "INTERRUPTED").catch(() => undefined);
      n += 1;
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// Ciclo do worker (instrumentation)
// ---------------------------------------------------------------------------

let timer: ReturnType<typeof setInterval> | null = null;

export function startOrchestratorWorker(): void {
  if (timer) return;
  const tick = () => {
    recoverStale()
      .then(() => dispatch())
      .catch((error) => logger.error("orchestrator_tick_failed", { message: error instanceof Error ? error.message : String(error) }));
  };
  // Primeira passada logo após o boot: tarefas da execução anterior são marcadas e as da fila seguem.
  setTimeout(tick, 3_000);
  timer = setInterval(tick, 3_000);
  // Um funcionário por Projeto, criado sozinho (e conferido de vez em quando para projetos novos).
  const syncAgents = () => void syncProjectAgents().catch((error) => logger.error("orchestrator_sync_agents_failed", { message: error instanceof Error ? error.message : String(error) }));
  setTimeout(syncAgents, 4_000);
  // Kits de skills embutidos (ex.: Motion) entram no ~/.claude do servidor na primeira subida: valem para todos os agentes.
  setTimeout(() => void seedDefaultPacks(), 5_000);
  setTimeout(() => void seedGlobalClaudeMd().then((done) => done && logger.info("global_claude_md_seeded")).catch(() => undefined), 6_000);
  setInterval(syncAgents, 60_000);
  setInterval(() => void purgeOldTasks().catch(() => undefined), 6 * 3_600_000);
  // Faxina de disco: dependências/builds regeneráveis de agentes parados, transcrições velhas, caches e eventos antigos.
  const janitor = () => void cleanupStorage().catch((error) => logger.error("storage_cleanup_failed", { message: error instanceof Error ? error.message : String(error) }));
  setTimeout(janitor, 120_000);
  setInterval(janitor, 6 * 3_600_000);
}
