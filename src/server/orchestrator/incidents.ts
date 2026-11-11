import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { recordAuditEvent } from "@/server/audit/audit-log";
import { createDeploymentProvider } from "@/server/providers/provider-registry";
import { getDeploymentLogs } from "@/server/deployments/deployment-history";
import { buildManagerBrief, decideOnFailure, incidentTooOld, logTail, mayMergeForIncident, prNumberFromCommitMessage } from "@/lib/deploy-incidents";
import { agentBudget } from "./budget";
import { orchestratorBus } from "./bus";
import { submitSystemTask } from "./service";

/**
 * Incidente de deploy falho. Quando um deploy termina como FALHOU o Universe: (1) abre um incidente; (2) bloqueia o agente cujo PR
 * gerou o commit quebrado; (3) manda uma tarefa urgente ao ID Manager, que delega a quem achar a causa e CORRIGIR; (4) permite que
 * quem recebeu a delegação faça o merge da correção — SÓ dentro do incidente aberto e no repositório do sistema que falhou;
 * (5) o próximo deploy com sucesso fecha o incidente e libera o agente. 3 falhas seguidas ou 6 h sem resolver = escala para um humano.
 */

const log = (event: string, data: Record<string, unknown>) => logger.info(event, data);

async function managerAgent() {
  return prisma.agentProfile.findFirst({ where: { team: "CLT", slug: "id-manager", archivedAt: null }, select: { id: true, name: true, paused: true, dailyTokenLimit: true, monthlyTokenLimit: true } });
}

/** Tarefas do Manager criadas para este incidente (uma por tentativa): as tarefas delegadas por elas são quem conserta. */
async function incidentManagerTaskIds(incidentId: string): Promise<string[]> {
  const rows = await prisma.agentTask.findMany({ where: { idempotencyKey: { startsWith: `incident:${incidentId}:` } }, select: { id: true } });
  return rows.map((r) => r.id);
}

async function lockAgent(agentId: string, incidentId: string): Promise<boolean> {
  const agent = await prisma.agentProfile.findUnique({ where: { id: agentId }, select: { paused: true, lockedByIncidentId: true } });
  if (!agent) return false;
  const wasPaused = agent.paused && !agent.lockedByIncidentId;
  await prisma.agentProfile.update({ where: { id: agentId }, data: { paused: true, lockedByIncidentId: incidentId } });
  orchestratorBus.emit({ type: "agent", agentId });
  return wasPaused;
}

async function unlockAgent(incident: { id: string; culpritAgentId: string | null; culpritWasPaused: boolean }): Promise<boolean> {
  if (!incident.culpritAgentId) return false;
  const agent = await prisma.agentProfile.findUnique({ where: { id: incident.culpritAgentId }, select: { lockedByIncidentId: true } });
  // Só o incidente que bloqueou desbloqueia (outro incidente pode ter assumido o bloqueio).
  if (!agent || agent.lockedByIncidentId !== incident.id) return false;
  await prisma.agentProfile.update({ where: { id: incident.culpritAgentId }, data: { lockedByIncidentId: null, paused: incident.culpritWasPaused } });
  orchestratorBus.emit({ type: "agent", agentId: incident.culpritAgentId });
  return true;
}

/** Recusa (com explicação) qualquer publicação/merge de um agente bloqueado por incidente, mesmo numa tarefa que já estava rodando. */
export async function assertAgentNotLocked(agentId: string): Promise<void> {
  const agent = await prisma.agentProfile.findUnique({ where: { id: agentId }, select: { lockedByIncidentId: true } });
  if (!agent?.lockedByIncidentId) return;
  const incident = await prisma.deployIncident.findUnique({ where: { id: agent.lockedByIncidentId }, include: { application: { select: { name: true } } } });
  throw new ValidationError(`Você está bloqueado: o deploy de "${incident?.application.name ?? "um sistema"}" falhou com um commit seu e a equipe CLT está consertando. Não publique nem faça merge até o incidente fechar.`);
}

/** O agente da equipe CLT pode mergear este PR? (regra pura em `mayMergeForIncident`, aqui só os dados do banco). */
export async function assertCltMayMerge(agentId: string, prRepo: string): Promise<void> {
  const open = await prisma.deployIncident.findMany({ where: { status: "OPEN" }, include: { application: { select: { repository: true } } } });
  let lastReason = "";
  for (const inc of open) {
    const taskIds = await incidentManagerTaskIds(inc.id);
    const manager = taskIds.length ? await prisma.agentTask.findMany({ where: { id: { in: taskIds } }, select: { agentId: true } }) : [];
    const delegated = taskIds.length ? await prisma.agentTask.findMany({ where: { parentTaskId: { in: taskIds } }, select: { agentId: true } }) : [];
    const verdict = mayMergeForIncident({
      agentId,
      prRepo,
      incident: { status: inc.status, applicationRepo: inc.application.repository, commitRepo: inc.repository, managerAgentId: manager[0]?.agentId ?? null },
      delegatedAgentIds: delegated.map((d) => d.agentId),
    });
    if (verdict.ok) return;
    lastReason = verdict.reason;
  }
  const none = mayMergeForIncident({ agentId, prRepo, incident: null, delegatedAgentIds: [] });
  throw new ValidationError(lastReason || (none.ok ? "Merge não autorizado." : none.reason));
}

export interface DeployFailure {
  applicationId: string;
  deploymentExternalId: string;
  commitSha: string | null;
  commitMessage: string | null;
  repository: string | null;
}

/** Um deploy terminou FALHO. Idempotente por (sistema, deploy). Nunca derruba quem chama. */
export async function onDeployFailed(f: DeployFailure, now: Date = new Date()): Promise<void> {
  try {
    const already = await prisma.deployIncident.findUnique({ where: { applicationId_deploymentExternalId: { applicationId: f.applicationId, deploymentExternalId: f.deploymentExternalId } }, select: { id: true } });
    if (already) return;
    const app = await prisma.application.findUnique({ where: { id: f.applicationId }, include: { provider: true } });
    if (!app) return;
    const repository = f.repository ?? app.repository;
    const open = await prisma.deployIncident.findFirst({ where: { applicationId: f.applicationId, status: "OPEN" }, orderBy: { createdAt: "desc" } });
    const decision = decideOnFailure(open);

    if (decision.kind === "escalate" && open) {
      await prisma.deployIncident.update({ where: { id: open.id }, data: { status: "ESCALATED", attempts: decision.attempts, deploymentExternalId: f.deploymentExternalId, summary: `${open.summary ?? ""}\nTentativa ${decision.attempts}: o deploy falhou de novo. Chegou ao limite: precisa de um humano.`.trim() } });
      await recordAuditEvent({ action: "AGENT_PROFILE_UPDATED", status: "FAILED", entityType: "DeployIncident", entityId: open.id, metadata: { event: "escalated", attempts: decision.attempts } });
      log("deploy_incident_escalated", { incidentId: open.id, attempts: decision.attempts });
      return;
    }

    // Deploy deste commit: ao vivo do Coolify (ou do histórico), só o FINAL — é onde está o erro.
    let tail: string | null = null;
    let note: string | null = null;
    try {
      const logs = await getDeploymentLogs(app.id, createDeploymentProvider(app.provider), f.deploymentExternalId);
      tail = logs.lines.length ? logTail(logs.lines.map((l) => l.raw)) : null;
      note = logs.note;
    } catch (error) {
      note = `não consegui ler o log (${error instanceof Error ? error.message.slice(0, 120) : "erro"})`;
    }

    const prNumber = prNumberFromCommitMessage(f.commitMessage);
    const pr = prNumber && repository ? await prisma.agentPullRequest.findFirst({ where: { number: prNumber, repo: { equals: repository.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, ""), mode: "insensitive" } }, include: { agent: { select: { id: true, name: true, team: true } } } }) : null;
    const culprit = pr && pr.agent.team !== "CLT" ? pr.agent : null;

    const incident =
      decision.kind === "retry" && open
        ? await prisma.deployIncident.update({ where: { id: open.id }, data: { attempts: decision.attempts, deploymentExternalId: f.deploymentExternalId, commitSha: f.commitSha, commitMessage: f.commitMessage } })
        : await prisma.deployIncident.create({
            data: { applicationId: app.id, deploymentExternalId: f.deploymentExternalId, commitSha: f.commitSha, commitMessage: f.commitMessage, repository, culpritAgentId: culprit?.id ?? null },
          });

    // Bloqueia o culpado (só no incidente novo: numa nova tentativa ele já está bloqueado).
    if (decision.kind === "new" && culprit) {
      const wasPaused = await lockAgent(culprit.id, incident.id);
      await prisma.deployIncident.update({ where: { id: incident.id }, data: { culpritWasPaused: wasPaused } });
    }

    const manager = await managerAgent();
    let summary = incident.summary ?? "";
    if (!manager) summary += "\nA equipe CLT ainda não foi criada: ninguém foi acionado.";
    else {
      const budget = await agentBudget(manager.id, { dailyTokenLimit: manager.dailyTokenLimit, monthlyTokenLimit: manager.monthlyTokenLimit }, now);
      if (budget.blocked) {
        await prisma.deployIncident.update({ where: { id: incident.id }, data: { status: "ESCALATED", summary: `${summary}\nO ID Manager está sem orçamento de tokens: ${budget.reason}`.trim() } });
        return;
      }
      const prior = decision.kind === "retry" && open?.managerTaskId ? await prisma.agentTask.findUnique({ where: { id: open.managerTaskId }, select: { result: true, error: true } }) : null;
      const brief = buildManagerBrief({
        application: app.name,
        repository,
        commitSha: f.commitSha,
        commitMessage: f.commitMessage,
        prNumber,
        culpritAgent: culprit?.name ?? null,
        attempts: decision.kind === "retry" ? decision.attempts : 1,
        logTail: tail,
        logNote: note,
        previousSummary: prior ? (prior.result ?? prior.error ?? "").replace(/\s+/g, " ").slice(0, 600) || null : null,
      });
      const attempt = decision.kind === "retry" ? decision.attempts : 1;
      const { task } = await submitSystemTask({ agentId: manager.id, prompt: brief, idempotencyKey: `incident:${incident.id}:${attempt}`, priority: 1 });
      await prisma.deployIncident.update({ where: { id: incident.id }, data: { managerTaskId: task.id } });
      summary += `\nTentativa ${attempt}: tarefa ${task.id.slice(-6)} enviada ao ID Manager${culprit ? `; agente ${culprit.name} bloqueado` : ""}.`;
    }
    await prisma.deployIncident.update({ where: { id: incident.id }, data: { summary: summary.trim() } });
    await recordAuditEvent({ applicationId: app.id, action: "AGENT_TASK_SUBMITTED", status: "SUCCESS", entityType: "DeployIncident", entityId: incident.id, metadata: { event: decision.kind, culpritAgentId: culprit?.id, attempts: incident.attempts } });
    log("deploy_incident_opened", { incidentId: incident.id, application: app.name, kind: decision.kind, culprit: culprit?.name });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return; // outro processo abriu o mesmo incidente
    logger.error("deploy_incident_failed", { applicationId: f.applicationId, message: error instanceof Error ? error.message.slice(0, 300) : String(error) });
  }
}

/** Um deploy terminou com SUCESSO: se havia incidente aberto neste sistema, está resolvido e o culpado é liberado. */
export async function onDeploySucceeded(applicationId: string, now: Date = new Date()): Promise<void> {
  try {
    const open = await prisma.deployIncident.findMany({ where: { applicationId, status: "OPEN" } });
    for (const inc of open) {
      await prisma.deployIncident.update({ where: { id: inc.id }, data: { status: "RESOLVED", resolvedAt: now, summary: `${inc.summary ?? ""}\nResolvido: um deploy seguinte teve sucesso.`.trim() } });
      const released = await unlockAgent(inc);
      await recordAuditEvent({ applicationId, action: "AGENT_PROFILE_UPDATED", status: "SUCCESS", entityType: "DeployIncident", entityId: inc.id, metadata: { event: "resolved", agentReleased: released } });
      log("deploy_incident_resolved", { incidentId: inc.id, agentReleased: released });
    }
  } catch (error) {
    logger.error("deploy_incident_resolve_failed", { applicationId, message: error instanceof Error ? error.message.slice(0, 300) : String(error) });
  }
}

/** A cada poucos minutos: incidente aberto há mais de 6 h sem resolver vira "precisa de humano" (o agente bloqueado continua bloqueado). */
export async function escalateStaleIncidents(now: Date = new Date()): Promise<number> {
  const open = await prisma.deployIncident.findMany({ where: { status: "OPEN" } });
  let n = 0;
  for (const inc of open) {
    if (!incidentTooOld(inc.createdAt, now)) continue;
    await prisma.deployIncident.update({ where: { id: inc.id }, data: { status: "ESCALATED", summary: `${inc.summary ?? ""}\nMais de 6 h sem resolver: precisa de um humano.`.trim() } });
    n += 1;
  }
  return n;
}

export interface IncidentView {
  id: string;
  application: string;
  status: string;
  attempts: number;
  commit: string | null;
  commitMessage: string | null;
  culprit: { id: string; name: string; locked: boolean } | null;
  createdAt: string;
  resolvedAt: string | null;
  summary: string | null;
}

export async function listIncidents(limit = 10): Promise<IncidentView[]> {
  const rows = await prisma.deployIncident.findMany({ orderBy: { createdAt: "desc" }, take: limit, include: { application: { select: { name: true } } } });
  const ids = rows.map((r) => r.culpritAgentId).filter((x): x is string => !!x);
  const agents = ids.length ? await prisma.agentProfile.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, lockedByIncidentId: true } }) : [];
  return rows.map((r) => {
    const a = agents.find((x) => x.id === r.culpritAgentId);
    return {
      id: r.id,
      application: r.application.name,
      status: r.status,
      attempts: r.attempts,
      commit: r.commitSha?.slice(0, 7) ?? null,
      commitMessage: r.commitMessage?.split("\n")[0] ?? null,
      culprit: a ? { id: a.id, name: a.name, locked: a.lockedByIncidentId === r.id } : null,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      summary: r.summary,
    };
  });
}

/** Ações do painel: liberar o agente bloqueado e/ou dar o incidente por resolvido (decisão humana). */
export async function actOnIncident(id: string, action: "unlock" | "resolve", actor: { userId: string; ip?: string; userAgent?: string }): Promise<IncidentView> {
  const inc = await prisma.deployIncident.findUnique({ where: { id } });
  if (!inc) throw new NotFoundError("Incidente não encontrado.");
  if (action === "resolve") {
    await prisma.deployIncident.update({ where: { id }, data: { status: "RESOLVED", resolvedAt: new Date(), summary: `${inc.summary ?? ""}\nFechado manualmente.`.trim() } });
  }
  const released = await unlockAgent(inc);
  await recordAuditEvent({ userId: actor.userId, action: "AGENT_PROFILE_UPDATED", status: "SUCCESS", entityType: "DeployIncident", entityId: id, metadata: { event: action, agentReleased: released }, ipAddress: actor.ip, userAgent: actor.userAgent });
  return (await listIncidents(50)).find((v) => v.id === id)!;
}

