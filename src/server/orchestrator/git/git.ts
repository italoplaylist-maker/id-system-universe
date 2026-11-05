import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { githubWebBase } from "@/server/github/github-api";
import { redactSecrets } from "@/server/claude/agent-service";
import { workspaceRoot } from "../workspace";

/** Onde os repositórios são clonados/enviados. GITHUB_GIT_URL permite apontar para outro host (GitHub Enterprise e testes locais). */
export function gitBase(): string {
  return (process.env.GITHUB_GIT_URL ?? githubWebBase()).replace(/\/$/, "");
}

export function remoteUrl(fullName: string): string {
  return `${gitBase()}/${fullName}.git`;
}

/** Ambiente do git com o token do App só em variável de ambiente (nunca em argumento, arquivo ou .git/config). */
export function gitEnv(token: string | null, identity?: { name: string; email: string }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  if (token && gitBase().startsWith("http")) {
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = `http.${gitBase()}/.extraheader`;
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  }
  if (identity) {
    env.GIT_AUTHOR_NAME = identity.name;
    env.GIT_COMMITTER_NAME = identity.name;
    env.GIT_AUTHOR_EMAIL = identity.email;
    env.GIT_COMMITTER_EMAIL = identity.email;
  }
  return env;
}

export interface GitResult {
  code: number | null;
  out: string;
}

export function runGit(cwd: string, args: string[], env: NodeJS.ProcessEnv = gitEnv(null), timeoutMs = 10 * 60_000): Promise<GitResult> {
  return new Promise((resolveP) => {
    let out = "";
    const p = spawn("git", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => (clearTimeout(t), resolveP({ code, out })));
    p.on("error", (e) => (clearTimeout(t), resolveP({ code: null, out: e.message })));
  });
}

/** Saída do git sem segredos e curta (vai para mensagem de erro/registro). */
export function cleanOut(out: string, max = 400): string {
  return redactSecrets(out).trim().slice(-max);
}

/** O caminho está DENTRO da pasta de trabalhos dos agentes (e não é ela)? Nunca apagar/mexer fora disso. */
export async function isInsideWorkspaceRoot(path: string): Promise<boolean> {
  const root = resolve(workspaceRoot());
  let real = resolve(path);
  try {
    real = await realpath(real);
  } catch {
    // ainda não existe: vale o caminho lógico
  }
  let realRoot = root;
  try {
    realRoot = await realpath(root);
  } catch {
    // raiz ainda não existe
  }
  return (real.startsWith(realRoot + sep) || real.startsWith(root + sep)) && real !== realRoot && real !== root;
}
