import { githubApiBase, getInstallationToken, appRequest, forgetInstallationToken } from "@/server/github/github-api";
import { ProviderError } from "@/lib/errors";

export interface GhResponse<T = unknown> {
  status: number;
  data: T;
}

/** Fala com o GitHub como o App (token de instalação). Devolve o status em vez de lançar: quem chama decide o que 404/405/422 significam. */
export async function ghFetch<T = unknown>(installationId: string, method: string, path: string, body?: unknown): Promise<GhResponse<T>> {
  const token = await getInstallationToken(installationId);
  let res: Response;
  try {
    res = await fetch(`${githubApiBase()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "id-system-universe",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch {
    throw new ProviderError("Não foi possível falar com o GitHub agora.", "GitHub");
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data: data as T };
}

export interface InstallationPermissions {
  contents?: string;
  pull_requests?: string;
  [k: string]: string | undefined;
}

/** O que o App tem permissão de fazer nesta instalação (para avisar ANTES de tentar e falhar). */
export async function getInstallationPermissions(installationId: string): Promise<InstallationPermissions> {
  const info = await appRequest<{ permissions?: InstallationPermissions }>(`/app/installations/${encodeURIComponent(installationId)}`);
  return info.permissions ?? {};
}

export interface InstallationInfo {
  permissions: InstallationPermissions;
  accountLogin: string | null;
}

/** O que o GitHub diz AGORA sobre esta instalação (permissões já aceitas, não as pedidas). */
export async function getInstallationInfo(installationId: string): Promise<InstallationInfo> {
  const info = await appRequest<{ permissions?: InstallationPermissions; account?: { login?: string } }>(`/app/installations/${encodeURIComponent(installationId)}`);
  return { permissions: info.permissions ?? {}, accountLogin: info.account?.login ?? null };
}

/**
 * Token novo (descarta o guardado). Um token já emitido NÃO ganha as permissões que você acabou de aceitar no GitHub:
 * ele só as herda quando vence (até 1 h). Para operações de escrita sempre pedimos um token novo.
 */
export async function freshInstallationToken(installationId: string): Promise<string> {
  forgetInstallationToken(installationId);
  return getInstallationToken(installationId);
}

/** Permissões extras para o merge poder LER a CI (sem elas o merge seria às cegas, então é recusado). */
export function missingMergePermissions(p: InstallationPermissions): string[] {
  const missing: string[] = [];
  if (!p.checks) missing.push("Checks: Read-only");
  if (!p.statuses) missing.push("Commit statuses: Read-only");
  return missing;
}

export function missingWritePermissions(p: InstallationPermissions): string[] {
  const missing: string[] = [];
  if (p.contents !== "write") missing.push("Contents: Read & write");
  if (p.pull_requests !== "write") missing.push("Pull requests: Read & write");
  return missing;
}
