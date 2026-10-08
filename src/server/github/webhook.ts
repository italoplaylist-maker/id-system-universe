import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { enqueueGitHubDeploy, runDeploymentQueueTick, type EnqueueOutcome } from "@/server/deployments/deployment-queue";
import { getGitHubCredentials, verifyWebhookSignature } from "@/server/github/github-api";
import { syncInstallationRepositories, upsertInstallation } from "@/server/github/github-service";

export interface WebhookResult {
  status: number;
  body: { ok: boolean; message?: string; duplicate?: boolean; outcomes?: EnqueueOutcome[] };
}

interface RepoPayload {
  full_name?: string;
  html_url?: string;
}

interface PushPayload {
  ref?: string;
  after?: string;
  deleted?: boolean;
  repository?: RepoPayload;
  head_commit?: { id?: string; message?: string; url?: string; author?: { name?: string; username?: string } } | null;
  pusher?: { name?: string };
}

interface PullRequestPayload {
  action?: string;
  repository?: RepoPayload;
  pull_request?: {
    merged?: boolean;
    merge_commit_sha?: string | null;
    title?: string;
    html_url?: string;
    base?: { ref?: string };
    merged_by?: { login?: string } | null;
    user?: { login?: string } | null;
  };
}

interface InstallationPayload {
  action?: string;
  installation?: { id: number; account: { login: string; type: string; id: number } | null; repository_selection?: string; suspended_at?: string | null };
}

const SHA_PATTERN = /^[0-9a-f]{7,64}$/i;
const ZERO_SHA = /^0+$/;

/**
 * Entrada ÚNICA de webhooks do GitHub. Ordem importa: assinatura (sobre o corpo
 * bruto) → deduplicação por delivery id → processamento. O GitHub nunca fala com
 * o Coolify: aqui só enfileiramos, e o Universe decide quando e como implantar.
 */
export async function handleGitHubWebhook(
  rawBody: string,
  headers: { signature: string | null; deliveryId: string | null; event: string | null },
  options: { processQueue?: boolean } = {},
): Promise<WebhookResult> {
  const credentials = await getGitHubCredentials();
  if (!credentials) return { status: 503, body: { ok: false, message: "GitHub App não configurado." } };

  if (!verifyWebhookSignature(credentials.webhookSecret, rawBody, headers.signature)) {
    return { status: 401, body: { ok: false, message: "Assinatura inválida." } };
  }
  if (!headers.deliveryId || !headers.event) return { status: 400, body: { ok: false, message: "Cabeçalhos do webhook ausentes." } };

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { ok: false, message: "Corpo inválido." } };
  }

  const action = typeof (payload as { action?: unknown }).action === "string" ? (payload as { action: string }).action : undefined;
  try {
    await prisma.gitHubWebhookDelivery.create({ data: { deliveryId: headers.deliveryId, event: headers.event, action } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { status: 200, body: { ok: true, duplicate: true } };
    }
    throw error;
  }

  try {
    const outcomes = await dispatch(headers.event, payload, headers.deliveryId);
    await prisma.gitHubWebhookDelivery.update({ where: { deliveryId: headers.deliveryId }, data: { status: "PROCESSED", processedAt: new Date() } });
    if ((options.processQueue ?? true) && outcomes.some((o) => o.result === "QUEUED")) {
      // Não bloqueia a resposta ao GitHub (que tem timeout curto); o tick periódico cobre qualquer falha.
      runDeploymentQueueTick().catch((error) => logger.error("deployment_tick_after_webhook_failed", { message: error instanceof Error ? error.message : String(error) }));
    }
    return { status: 200, body: { ok: true, outcomes } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("github_webhook_failed", { event: headers.event, deliveryId: headers.deliveryId, message });
    await prisma.gitHubWebhookDelivery.update({ where: { deliveryId: headers.deliveryId }, data: { status: "FAILED", error: message.slice(0, 500), processedAt: new Date() } });
    return { status: 500, body: { ok: false, message: "Falha ao processar o evento." } };
  }
}

async function dispatch(event: string, payload: unknown, deliveryId: string): Promise<EnqueueOutcome[]> {
  switch (event) {
    case "push":
      return handlePush(payload as PushPayload, deliveryId);
    case "pull_request":
      return handlePullRequest(payload as PullRequestPayload, deliveryId);
    case "installation":
      await handleInstallation(payload as InstallationPayload);
      return [];
    case "installation_repositories":
      await handleInstallationRepositories(payload as InstallationPayload);
      return [];
    default:
      return []; // ping e demais eventos: reconhecidos, sem ação
  }
}

async function handlePush(payload: PushPayload, deliveryId: string): Promise<EnqueueOutcome[]> {
  const repository = payload.repository?.full_name;
  const ref = payload.ref;
  const sha = payload.after ?? payload.head_commit?.id;
  if (!repository || !ref?.startsWith("refs/heads/") || !sha) return [];
  if (payload.deleted || ZERO_SHA.test(sha) || !SHA_PATTERN.test(sha)) return [];

  return enqueueGitHubDeploy({
    repository,
    branch: ref.slice("refs/heads/".length),
    commitSha: sha.toLowerCase(),
    commitMessage: payload.head_commit?.message?.split("\n")[0]?.slice(0, 300) ?? null,
    commitAuthor: payload.head_commit?.author?.username ?? payload.head_commit?.author?.name ?? payload.pusher?.name ?? null,
    commitUrl: payload.head_commit?.url ?? (payload.repository?.html_url ? `${payload.repository.html_url}/commit/${sha}` : null),
    trigger: "GITHUB_PUSH",
    deliveryId,
  });
}

async function handlePullRequest(payload: PullRequestPayload, deliveryId: string): Promise<EnqueueOutcome[]> {
  const pr = payload.pull_request;
  const repository = payload.repository?.full_name;
  if (payload.action !== "closed" || !pr?.merged || !repository || !pr.base?.ref || !pr.merge_commit_sha) return [];
  if (!SHA_PATTERN.test(pr.merge_commit_sha)) return [];

  return enqueueGitHubDeploy({
    repository,
    branch: pr.base.ref,
    commitSha: pr.merge_commit_sha.toLowerCase(),
    commitMessage: pr.title?.slice(0, 300) ?? null,
    commitAuthor: pr.merged_by?.login ?? pr.user?.login ?? null,
    commitUrl: payload.repository?.html_url ? `${payload.repository.html_url}/commit/${pr.merge_commit_sha}` : (pr.html_url ?? null),
    trigger: "GITHUB_MERGE",
    deliveryId,
  });
}

async function handleInstallation(payload: InstallationPayload): Promise<void> {
  const installation = payload.installation;
  if (!installation) return;
  if (payload.action === "deleted") {
    await prisma.gitHubInstallation.updateMany({ where: { installationId: String(installation.id) }, data: { status: "DELETED" } });
    await prisma.gitHubRepository.deleteMany({ where: { installation: { installationId: String(installation.id) } } });
    return;
  }
  const row = await upsertInstallation(installation);
  if (payload.action === "created" || payload.action === "unsuspend") {
    await syncInstallationRepositories(row.id).catch((error) => logger.warn("github_repo_sync_failed", { message: error instanceof Error ? error.message : String(error) }));
  }
}

async function handleInstallationRepositories(payload: InstallationPayload): Promise<void> {
  const installation = payload.installation;
  if (!installation) return;
  const row = await upsertInstallation(installation);
  await syncInstallationRepositories(row.id).catch((error) => logger.warn("github_repo_sync_failed", { message: error instanceof Error ? error.message : String(error) }));
}
