import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { GitHubInstallation, GitHubRepository } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getEnv } from "@/lib/env";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/server/audit/audit-log";
import { recordUniverseEvent } from "@/server/events/universe-events";
import { getConfig, setConfig } from "@/server/integrations/config";
import { appRequest, forgetInstallationToken, getGitHubCredentials, githubWebBase, installationRequest, GitHubNotConfiguredError } from "@/server/github/github-api";

export interface GitHubActor {
  userId?: string;
  ip?: string;
  userAgent?: string;
}

// ---------------------------------------------------------------------------
// Configuração do App
// ---------------------------------------------------------------------------

export interface GitHubConfigStatus {
  configured: boolean;
  appId: string | null;
  appSlug: string | null;
  hasPrivateKey: boolean;
  hasWebhookSecret: boolean;
}

export async function getGitHubConfigStatus(): Promise<GitHubConfigStatus> {
  const [appId, appSlug, privateKey, webhookSecret] = await Promise.all([
    getConfig("github.appId"),
    getConfig("github.appSlug"),
    getConfig("github.privateKey"),
    getConfig("github.webhookSecret"),
  ]);
  return {
    configured: Boolean(appId && privateKey && webhookSecret),
    appId: appId ?? null,
    appSlug: appSlug ?? null,
    hasPrivateKey: Boolean(privateKey),
    hasWebhookSecret: Boolean(webhookSecret),
  };
}

const configSchema = z.object({
  appId: z.string().trim().regex(/^\d+$/, "O App ID é numérico.").optional(),
  appSlug: z.string().trim().regex(/^[A-Za-z0-9-]+$/, "Slug inválido.").optional(),
  // Segredos: ausente = manter o atual; string vazia = remover.
  privateKey: z.string().optional(),
  webhookSecret: z.string().optional(),
});

export async function updateGitHubConfig(input: unknown, actor: GitHubActor): Promise<GitHubConfigStatus> {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const { appId, appSlug, privateKey, webhookSecret } = parsed.data;

  if (privateKey && !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(privateKey)) {
    throw new ValidationError("A chave privada deve estar no formato PEM.");
  }
  if (webhookSecret && webhookSecret.length < 16) throw new ValidationError("O segredo do webhook deve ter ao menos 16 caracteres.");

  if (appId !== undefined) await setConfig("github.appId", appId);
  if (appSlug !== undefined) await setConfig("github.appSlug", appSlug);
  if (privateKey !== undefined) await setConfig("github.privateKey", privateKey.trim());
  if (webhookSecret !== undefined) await setConfig("github.webhookSecret", webhookSecret);

  await recordAuditEvent({
    userId: actor.userId,
    action: "GITHUB_CONFIG_UPDATED",
    status: "SUCCESS",
    entityType: "GitHubApp",
    // Nunca registra valores — só quais campos mudaram.
    metadata: { changed: Object.keys(parsed.data).filter((k) => parsed.data[k as keyof typeof parsed.data] !== undefined) },
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  });
  return getGitHubConfigStatus();
}

// ---------------------------------------------------------------------------
// Fluxo "Conectar GitHub" (instalação do App)
// ---------------------------------------------------------------------------

const STATE_TTL_MS = 60 * 60 * 1000;

function signState(payload: string): string {
  return createHmac("sha256", getEnv().AUTH_SECRET).update(`github-install:${payload}`).digest("base64url");
}

export function createInstallState(userId: string, now = Date.now()): string {
  const payload = `${userId}.${now}`;
  return `${Buffer.from(payload).toString("base64url")}.${signState(payload)}`;
}

export function verifyInstallState(state: string | null, userId: string, now = Date.now()): boolean {
  if (!state) return false;
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) return false;
  const payload = Buffer.from(encoded, "base64url").toString("utf8");
  const expected = Buffer.from(signState(payload));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return false;
  const [stateUser, issuedAt] = payload.split(".");
  return stateUser === userId && now - Number(issuedAt) < STATE_TTL_MS && now >= Number(issuedAt);
}

export async function buildInstallUrl(userId: string): Promise<string> {
  const credentials = await getGitHubCredentials();
  if (!credentials) throw new GitHubNotConfiguredError();
  if (!credentials.slug) throw new ConflictError("Informe o slug do GitHub App (o nome na URL github.com/apps/<slug>) para conectar.");
  const state = createInstallState(userId);
  return `${githubWebBase()}/apps/${encodeURIComponent(credentials.slug)}/installations/new?state=${encodeURIComponent(state)}`;
}

interface GitHubInstallationPayload {
  id: number;
  account: { login: string; type: string; id: number } | null;
  repository_selection?: string;
  suspended_at?: string | null;
}

export async function upsertInstallation(payload: GitHubInstallationPayload): Promise<GitHubInstallation> {
  const data = {
    accountLogin: payload.account?.login ?? "desconhecido",
    accountType: payload.account?.type ?? "Unknown",
    accountId: payload.account ? String(payload.account.id) : null,
    repositorySelection: payload.repository_selection ?? null,
    status: payload.suspended_at ? ("SUSPENDED" as const) : ("ACTIVE" as const),
  };
  return prisma.gitHubInstallation.upsert({
    where: { installationId: String(payload.id) },
    create: { installationId: String(payload.id), ...data },
    update: data,
  });
}

/** Callback do GitHub após instalar: confirma a instalação com o próprio App (não confia no query string). */
export async function connectInstallation(installationId: string, actor: GitHubActor): Promise<GitHubInstallation> {
  if (!/^\d+$/.test(installationId)) throw new ValidationError("Instalação inválida.");
  const remote = await appRequest<GitHubInstallationPayload>(`/app/installations/${installationId}`);
  const installation = await upsertInstallation(remote);
  await syncInstallationRepositories(installation.id);
  await recordAuditEvent({
    userId: actor.userId,
    action: "GITHUB_INSTALLATION_CONNECTED",
    status: "SUCCESS",
    entityType: "GitHubInstallation",
    entityId: installation.id,
    metadata: { account: installation.accountLogin },
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  });
  await recordUniverseEvent({ type: "GITHUB_CONNECTED", message: `GitHub conectado: ${installation.accountLogin}.` });
  return installation;
}

interface GitHubRepoPayload {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  default_branch?: string;
  private: boolean;
  archived?: boolean;
}

const MAX_REPO_PAGES = 30;

export async function syncInstallationRepositories(installationRowId: string): Promise<{ count: number }> {
  const installation = await prisma.gitHubInstallation.findUnique({ where: { id: installationRowId } });
  if (!installation) throw new NotFoundError("Instalação não encontrada.");

  const repos: GitHubRepoPayload[] = [];
  for (let page = 1; page <= MAX_REPO_PAGES; page += 1) {
    const result = await installationRequest<{ repositories: GitHubRepoPayload[] }>(installation.installationId, `/installation/repositories?per_page=100&page=${page}`);
    repos.push(...result.repositories);
    if (result.repositories.length < 100) break;
  }

  await prisma.$transaction(async (tx) => {
    for (const repo of repos) {
      const data = {
        fullName: repo.full_name,
        ownerLogin: repo.owner.login,
        name: repo.name,
        defaultBranch: repo.default_branch ?? null,
        isPrivate: repo.private,
        archived: repo.archived ?? false,
      };
      await tx.gitHubRepository.upsert({
        where: { installationId_externalId: { installationId: installation.id, externalId: String(repo.id) } },
        create: { installationId: installation.id, externalId: String(repo.id), ...data },
        update: data,
      });
    }
    await tx.gitHubRepository.deleteMany({
      where: { installationId: installation.id, externalId: { notIn: repos.map((r) => String(r.id)) } },
    });
    await tx.gitHubInstallation.update({ where: { id: installation.id }, data: { lastSyncedAt: new Date() } });
  });
  return { count: repos.length };
}

export async function syncAllInstallations(): Promise<void> {
  const installations = await prisma.gitHubInstallation.findMany({ where: { status: "ACTIVE" } });
  for (const installation of installations) {
    await syncInstallationRepositories(installation.id).catch((error) => {
      logger.warn("github_repo_sync_failed", { installation: installation.id, message: error instanceof Error ? error.message : String(error) });
    });
  }
}

export async function removeInstallation(installationRowId: string, actor: GitHubActor): Promise<void> {
  const installation = await prisma.gitHubInstallation.findUnique({ where: { id: installationRowId } });
  if (!installation) throw new NotFoundError("Instalação não encontrada.");
  // Só remove o vínculo local; desinstalar o App é feito no GitHub (e chega por webhook).
  await prisma.gitHubInstallation.delete({ where: { id: installation.id } });
  forgetInstallationToken(installation.installationId);
  await recordAuditEvent({
    userId: actor.userId,
    action: "GITHUB_INSTALLATION_REMOVED",
    status: "SUCCESS",
    entityType: "GitHubInstallation",
    entityId: installation.id,
    metadata: { account: installation.accountLogin },
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  });
  await recordUniverseEvent({ type: "GITHUB_DISCONNECTED", message: `GitHub desconectado: ${installation.accountLogin}.` });
}

export interface GitHubInstallationSummary {
  id: string;
  accountLogin: string;
  accountType: string;
  status: GitHubInstallation["status"];
  repositorySelection: string | null;
  repositoryCount: number;
  lastSyncedAt: string | null;
}

export async function listInstallations(): Promise<GitHubInstallationSummary[]> {
  const rows = await prisma.gitHubInstallation.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { repositories: true } } } });
  return rows.map((row) => ({
    id: row.id,
    accountLogin: row.accountLogin,
    accountType: row.accountType,
    status: row.status,
    repositorySelection: row.repositorySelection,
    repositoryCount: row._count.repositories,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
  }));
}

export interface GitHubRepositorySummary {
  id: string;
  fullName: string;
  ownerLogin: string;
  name: string;
  defaultBranch: string | null;
  isPrivate: boolean;
  installationId: string;
}

function toRepoSummary(repo: GitHubRepository): GitHubRepositorySummary {
  return { id: repo.id, fullName: repo.fullName, ownerLogin: repo.ownerLogin, name: repo.name, defaultBranch: repo.defaultBranch, isPrivate: repo.isPrivate, installationId: repo.installationId };
}

export async function listRepositories(): Promise<GitHubRepositorySummary[]> {
  const rows = await prisma.gitHubRepository.findMany({
    where: { archived: false, installation: { status: "ACTIVE" } },
    orderBy: { fullName: "asc" },
  });
  return rows.map(toRepoSummary);
}

export async function listBranches(repositoryId: string): Promise<string[]> {
  const repo = await prisma.gitHubRepository.findUnique({ where: { id: repositoryId }, include: { installation: true } });
  if (!repo) throw new NotFoundError("Repositório não encontrado.");
  const branches: string[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = await installationRequest<{ name: string }[]>(
      repo.installation.installationId,
      `/repos/${encodeURIComponent(repo.ownerLogin)}/${encodeURIComponent(repo.name)}/branches?per_page=100&page=${page}`,
    );
    branches.push(...result.map((b) => b.name));
    if (result.length < 100) break;
  }
  return branches;
}
