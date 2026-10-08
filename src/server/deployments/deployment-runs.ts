import { prisma } from "@/server/db/client";
import type { DeploymentRun, DeploymentRunStatus, Prisma } from "@prisma/client";
import type { ProviderDeployment } from "@/providers/deployment/types";

const TERMINAL_MAP: Record<string, DeploymentRunStatus | undefined> = {
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
};

/**
 * Fecha o(s) DeploymentRun ligado(s) a um deployment do Coolify, com o que o
 * provider REALMENTE reporta (status e commit implantado). Idempotente: só
 * mexe em runs ainda RUNNING.
 */
export async function finalizeRunsForDeployment(coolifyDeploymentId: string, deployment: Pick<ProviderDeployment, "status" | "commit" | "commitMessage">): Promise<number> {
  const status = TERMINAL_MAP[deployment.status];
  if (!status) return 0;
  const runs = await prisma.deploymentRun.findMany({ where: { coolifyDeploymentId, status: "RUNNING" } });
  for (const run of runs) {
    await prisma.deploymentRun.updateMany({
      where: { id: run.id, status: "RUNNING" },
      data: {
        status,
        finishedAt: new Date(),
        deployedCommitSha: deployment.commit ?? run.commitSha,
        commitMessage: run.commitMessage ?? deployment.commitMessage ?? null,
        error: status === "SUCCESS" ? null : `Deploy ${deployment.status === "CANCELLED" ? "cancelado" : "falhou"} no provider.`,
      },
    });
  }
  return runs.length;
}

export async function failRun(runId: string, error: string): Promise<void> {
  await prisma.deploymentRun.updateMany({ where: { id: runId, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "FAILED", finishedAt: new Date(), error } });
}

export async function recordManualRun(input: {
  applicationId: string;
  projectId: string | null;
  repository: string | null;
  branch: string | null;
  coolifyDeploymentId: string | undefined;
  userId?: string;
}): Promise<void> {
  await prisma.deploymentRun.create({
    data: {
      applicationId: input.applicationId,
      projectId: input.projectId,
      repository: input.repository,
      branch: input.branch,
      triggerSource: "MANUAL",
      status: "RUNNING",
      coolifyDeploymentId: input.coolifyDeploymentId,
      userId: input.userId,
      startedAt: new Date(),
    },
  });
}

export interface DeploymentRunSummary {
  id: string;
  repository: string | null;
  branch: string | null;
  commitSha: string | null;
  commitMessage: string | null;
  commitAuthor: string | null;
  commitUrl: string | null;
  triggerSource: DeploymentRun["triggerSource"];
  status: DeploymentRun["status"];
  coolifyDeploymentId: string | null;
  error: string | null;
  receivedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export function toRunSummary(run: DeploymentRun): DeploymentRunSummary {
  return {
    id: run.id,
    repository: run.repository,
    branch: run.branch,
    commitSha: run.deployedCommitSha ?? run.commitSha,
    commitMessage: run.commitMessage,
    commitAuthor: run.commitAuthor,
    commitUrl: run.commitUrl,
    triggerSource: run.triggerSource,
    status: run.status,
    coolifyDeploymentId: run.coolifyDeploymentId,
    error: run.error,
    receivedAt: run.receivedAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

export async function getRunsOverview(applicationId: string): Promise<{ production: DeploymentRunSummary | null; queued: DeploymentRunSummary | null; runs: DeploymentRunSummary[] }> {
  const [production, queued, runs] = await Promise.all([
    prisma.deploymentRun.findFirst({ where: { applicationId, status: "SUCCESS" }, orderBy: { finishedAt: "desc" } }),
    prisma.deploymentRun.findFirst({ where: { applicationId, status: "QUEUED" }, orderBy: { receivedAt: "desc" } }),
    prisma.deploymentRun.findMany({ where: { applicationId }, orderBy: { receivedAt: "desc" }, take: 20 }),
  ]);
  return {
    production: production ? toRunSummary(production) : null,
    queued: queued ? toRunSummary(queued) : null,
    runs: runs.map(toRunSummary),
  };
}

export type RunCreateInput = Prisma.DeploymentRunUncheckedCreateInput;
