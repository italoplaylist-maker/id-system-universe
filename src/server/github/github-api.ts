import { createSign, createHmac, timingSafeEqual } from "node:crypto";
import { AppError, ProviderError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getConfigs } from "@/server/integrations/config";

/** Base da API — configurável para GitHub Enterprise e para testes locais. */
export function githubApiBase(): string {
  return (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/$/, "");
}

export function githubWebBase(): string {
  return (process.env.GITHUB_WEB_URL ?? "https://github.com").replace(/\/$/, "");
}

export class GitHubNotConfiguredError extends AppError {
  constructor() {
    super("O GitHub App ainda não foi configurado (App ID, chave privada e segredo do webhook).", 409, "GITHUB_NOT_CONFIGURED");
  }
}

export interface GitHubAppCredentials {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  slug?: string;
}

export async function getGitHubCredentials(): Promise<GitHubAppCredentials | null> {
  const cfg = await getConfigs(["github.appId", "github.privateKey", "github.webhookSecret", "github.appSlug"]);
  if (!cfg["github.appId"] || !cfg["github.privateKey"] || !cfg["github.webhookSecret"]) return null;
  return {
    appId: cfg["github.appId"],
    privateKey: cfg["github.privateKey"],
    webhookSecret: cfg["github.webhookSecret"],
    slug: cfg["github.appSlug"],
  };
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** JWT RS256 do App (válido por poucos minutos) — usado só para falar como "o App" com o GitHub. */
export function createAppJwt(credentials: Pick<GitHubAppCredentials, "appId" | "privateKey">, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // iat 60s no passado absorve diferença de relógio; exp máximo permitido pelo GitHub é 10 min.
  const payload = base64Url(JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 9 * 60, iss: credentials.appId }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(credentials.privateKey);
  return `${header}.${payload}.${base64Url(signature)}`;
}

/** Verifica X-Hub-Signature-256 em tempo constante. */
export function verifyWebhookSignature(secret: string, rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signatureHeader.slice("sha256=".length), "hex");
  } catch {
    return false;
  }
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

interface TokenEntry {
  token: string;
  expiresAt: number;
}
const installationTokens = new Map<string, TokenEntry>();

async function githubRequest<T>(path: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${githubApiBase()}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "id-system-universe",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch (error) {
    logger.warn("github_request_failed", { path, message: error instanceof Error ? error.message : String(error) });
    throw new ProviderError("Não foi possível falar com o GitHub agora.", "GitHub");
  }
  if (!response.ok) {
    logger.warn("github_request_rejected", { path, status: response.status });
    throw new ProviderError(
      response.status === 401 || response.status === 403 ? "O GitHub recusou as credenciais do App." : `O GitHub respondeu com erro (${response.status}).`,
      "GitHub",
    );
  }
  return (await response.json()) as T;
}

export async function appRequest<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const credentials = await getGitHubCredentials();
  if (!credentials) throw new GitHubNotConfiguredError();
  return githubRequest<T>(path, createAppJwt(credentials), init);
}

export async function getInstallationToken(installationId: string): Promise<string> {
  const cached = installationTokens.get(installationId);
  if (cached && cached.expiresAt - Date.now() > 60_000) return cached.token;
  const result = await appRequest<{ token: string; expires_at: string }>(`/app/installations/${encodeURIComponent(installationId)}/access_tokens`, { method: "POST" });
  installationTokens.set(installationId, { token: result.token, expiresAt: new Date(result.expires_at).getTime() });
  return result.token;
}

export function forgetInstallationToken(installationId: string): void {
  installationTokens.delete(installationId);
}

export async function installationRequest<T>(installationId: string, path: string): Promise<T> {
  return githubRequest<T>(path, await getInstallationToken(installationId));
}
