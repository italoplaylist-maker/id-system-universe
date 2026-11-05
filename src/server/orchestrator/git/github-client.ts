import { githubApiBase, getInstallationToken, appRequest } from "@/server/github/github-api";
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

export function missingWritePermissions(p: InstallationPermissions): string[] {
  const missing: string[] = [];
  if (p.contents !== "write") missing.push("Contents: Read & write");
  if (p.pull_requests !== "write") missing.push("Pull requests: Read & write");
  return missing;
}
