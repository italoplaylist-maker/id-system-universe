import { Prisma, type DeploymentTrigger } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { ConflictError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createDeploymentProvider } from "@/server/providers/provider-registry";
import { reconcileApplicationNow, redeployApplication } from "@/server/applications/application-service";
import { recordAuditEvent } from "@/server/audit/audit-log";
import { recordUniverseEvent } from "@/server/events/universe-events";
import { failRun, finalizeRunsForDeployment } from "@/server/deployments/deployment-runs";

/** Deploys que passam disso sem terminar são dados como falhos (nunca ficam RUNNING para sempre). */
const RUN_TIMEOUT_MS = 30 * 60 * 1000;
/** Run marcado RUNNING que nunca recebeu id do Coolify (processo caiu no meio do disparo). */
const START_GRACE_MS = 2 * 60 * 1000;

export interface GitHubDeployEvent {
  repository: string;
  branch: string;
  commitSha: string;
  commitMessage: string | null;
  commitAuthor: string | null;
  commitUrl: string | null;
  trigger: Extract<DeploymentTrigger, "GITHUB_PUSH" | "GITHUB_MERGE">;
  deliveryId: string | null;
}

export type EnqueueOutcome = { applicationId: string; result: "QUEUED" | "DUPLICATE" | "SKIPPED"; reason?: string };

/**
 * Procura os Resources vinculados a este repositório/branch com Auto Deploy
 * ligado para o tipo de evento, e enfileira UM DeploymentRun por Resource.
 * A unique (resource, repo, branch, sha) garante: o mesmo commit nunca vira
 * dois deploys — nem se o GitHub reenviar o webhook, nem se merge+push chegarem.
 */
export async function enqueueGitHubDeploy(event: GitHubDeployEvent): Promise<EnqueueOutcome[]> {
  const links = await prisma.resourceRepository.findMany({
    where: { repositoryFullName: { equals: event.repository, mode: "insensitive" }, branch: event.branch, autoDeploy: true },
    include: { application: { select: { id: true, name: true, projectId: true, resourceType: true, project: { select: { name: true } } } } },
  });

  const outcomes: EnqueueOutcome[] = [];
  for (const link of links) {
    const wantsTrigger = event.trigger === "GITHUB_PUSH" ? link.onPush : link.onMerge;
    if (!wantsTrigger) {
      outcomes.push({ applicationId: link.applicationId, result: "SKIPPED", reason: "Evento desativado para este Resource." });
      continue;
    }
    if (link.application.resourceType !== "APPLICATION") {
      outcomes.push({ applicationId: link.applicationId, result: "SKIPPED", reason: "Somente aplicações suportam deploy." });
      continue;
    }

    try {
      await prisma.deploymentRun.create({
        data: {
          applicationId: link.applicationId,
          projectId: link.application.projectId,
          repository: event.repository,
          branch: event.branch,
          commitSha: event.commitSha,
          commitMessage: event.commitMessage,
          commitAuthor: event.commitAuthor,
          commitUrl: event.commitUrl,
          triggerSource: event.trigger,
          deliveryId: event.deliveryId,
          status: "QUEUED",
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        outcomes.push({ applicationId: link.applicationId, result: "DUPLICATE" });
        continue;
      }
      throw error;
    }

    const label = `${link.application.project ? `${link.application.project.name} / ` : ""}${link.application.name}`;
    await recordUniverseEvent({
      type: "GITHUB_DEPLOY_QUEUED",
      message: `Nova versão em ${label}: ${event.commitSha.slice(0, 7)} (${event.branch}) na fila para implantação.`,
      applicationId: link.applicationId,
      applicationName: link.application.name,
      projectId: link.application.projectId,
      projectName: link.application.project?.name,
    });
    await recordAuditEvent({
      applicationId: link.applicationId,
      projectId: link.application.projectId,
      action: "GITHUB_AUTO_DEPLOY",
      status: "REQUESTED",
      metadata: { repository: event.repository, branch: event.branch, commitSha: event.commitSha, trigger: event.trigger, deliveryId: event.deliveryId },
    });
    outcomes.push({ applicationId: link.applicationId, result: "QUEUED" });
  }
  return outcomes;
}

/** Resolve runs que o app deixou em RUNNING: terminou? falhou? expirou? Nunca inventa sucesso. */
async function settleRunningRuns(applicationId: string): Promise<{ stillRunning: boolean }> {
  const runs = await prisma.deploymentRun.findMany({ where: { applicationId, status: "RUNNING" } });
  if (runs.length === 0) return { stillRunning: false };

  // Reconciliar o application detail já fecha o run quando o Coolify reporta estado final.
  await reconcileApplicationNow(applicationId).catch(() => undefined);

  let stillRunning = false;
  for (const run of await prisma.deploymentRun.findMany({ where: { applicationId, status: "RUNNING" } })) {
    const startedAt = run.startedAt?.getTime() ?? run.createdAt.getTime();
    if (!run.coolifyDeploymentId) {
      if (Date.now() - startedAt > START_GRACE_MS) await failRun(run.id, "O deploy não chegou a ser iniciado no provider.");
      else stillRunning = true;
      continue;
    }
    try {
      const app = await prisma.application.findUnique({ where: { id: applicationId }, include: { provider: true } });
      if (app) {
        const deployment = await createDeploymentProvider(app.provider).getDeployment(run.coolifyDeploymentId);
        if (await finalizeRunsForDeployment(run.coolifyDeploymentId, deployment)) continue;
      }
    } catch (error) {
      logger.warn("run_settle_check_failed", { runId: run.id, message: error instanceof Error ? error.message : String(error) });
    }
    if (Date.now() - startedAt > RUN_TIMEOUT_MS) await failRun(run.id, "Tempo limite excedido acompanhando o deploy.");
    else stillRunning = true;
  }
  return { stillRunning };
}

/**
 * Nunca dois deploys simultâneos do mesmo Resource. Se chegaram A (rodando),
 * B e C (na fila): B e C continuam no histórico, mas só C (o mais recente)
 * é implantado depois de A — B vira SUPERSEDED.
 */
export async function processDeploymentQueue(applicationId: string): Promise<"IDLE" | "BUSY" | "STARTED" | "FAILED"> {
  const { stillRunning } = await settleRunningRuns(applicationId);
  if (stillRunning) return "BUSY";

  const queued = await prisma.deploymentRun.findMany({ where: { applicationId, status: "QUEUED" }, orderBy: { receivedAt: "desc" } });
  const [latest, ...obsolete] = queued;
  if (!latest) return "IDLE";

  const app = await prisma.application.findUnique({ where: { id: applicationId }, select: { pendingOperation: true, pendingSince: true } });
  if (!app) return "IDLE";
  if (app.pendingOperation) return "BUSY"; // uma operação manual/imediata está em andamento

  // Reivindica o run de forma atômica: dois ticks/processos nunca iniciam o mesmo.
  const claimed = await prisma.deploymentRun.updateMany({ where: { id: latest.id, status: "QUEUED" }, data: { status: "RUNNING", startedAt: new Date() } });
  if (claimed.count === 0) return "BUSY";

  if (obsolete.length > 0) {
    await prisma.deploymentRun.updateMany({
      where: { id: { in: obsolete.map((r) => r.id) }, status: "QUEUED" },
      data: { status: "SUPERSEDED", finishedAt: new Date(), error: `Substituído pelo commit mais recente ${latest.commitSha?.slice(0, 7) ?? ""}.`.trim() },
    });
  }

  try {
    await redeployApplication(applicationId, false, {}, { runId: latest.id });
    return "STARTED";
  } catch (error) {
    if (error instanceof ConflictError) {
      // Alguém tomou o lock entre a checagem e o disparo: volta para a fila, sem perder o commit.
      await prisma.deploymentRun.updateMany({ where: { id: latest.id, status: "RUNNING" }, data: { status: "QUEUED", startedAt: null } });
      return "BUSY";
    }
    // Falha real (Coolify fora etc.): registra no run e segue — a operação não se perde, fica visível como FAILED.
    await failRun(latest.id, error instanceof Error ? error.message : "Falha ao iniciar o deploy.");
    await recordUniverseEvent({
      type: "DEPLOYMENT_FAILED",
      message: `Falha ao iniciar o deploy automático do commit ${latest.commitSha?.slice(0, 7) ?? ""}.`,
      applicationId,
      projectId: latest.projectId,
    });
    return "FAILED";
  }
}

let ticking = false;

/** Roda periodicamente (instrumentation) e também logo após cada webhook. */
export async function runDeploymentQueueTick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const pending = await prisma.deploymentRun.findMany({
      where: { status: { in: ["QUEUED", "RUNNING"] } },
      select: { applicationId: true },
      distinct: ["applicationId"],
    });
    for (const { applicationId } of pending) {
      await processDeploymentQueue(applicationId).catch((error) => {
        logger.error("deployment_queue_failed", { applicationId, message: error instanceof Error ? error.message : String(error) });
      });
    }
  } finally {
    ticking = false;
  }
}
