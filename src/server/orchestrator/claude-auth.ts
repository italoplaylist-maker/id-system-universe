import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { ValidationError } from "@/lib/errors";

/**
 * Login do Claude pela conta de assinatura (Claude Code) feito DENTRO do Universe.
 * Usa o próprio comando oficial `claude auth login`: ele imprime a URL de autorização e espera o
 * código que a página devolve ("Paste code here"). Nada de API inventada — só orquestramos a CLI.
 * As credenciais ficam onde o Claude Code sempre guarda (~/.claude), no servidor.
 */

const LOGIN_TTL_MS = 10 * 60_000;

interface LoginAttempt {
  proc: ChildProcessWithoutNullStreams;
  url: string;
  stderr: string;
  exited: Promise<number | null>;
  timer: ReturnType<typeof setTimeout>;
}
const g = globalThis as unknown as { __isuClaudeLogin?: LoginAttempt | null };

export function claudeBinary(): string {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const names = process.platform === "darwin" ? [`darwin-${arch}`] : [`linux-${arch}`, `linux-${arch}-musl`];
  // O pacote nativo do SDK vem em node_modules (standalone inclui; ver next.config.ts). Sem `require.resolve`: o webpack o reescreve.
  const roots = [process.cwd(), process.argv[1] ? dirname(process.argv[1]) : ""].filter(Boolean);
  for (const root of roots) {
    for (const n of names) {
      const bin = join(root, "node_modules", "@anthropic-ai", `claude-agent-sdk-${n}`, "claude");
      if (existsSync(bin)) return bin;
    }
  }
  throw new ValidationError("Binário do Claude Code não encontrado neste servidor.");
}

function run(args: string[], timeoutMs: number): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    let out = "";
    const p = spawn(claudeBinary(), args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => {
      clearTimeout(t);
      resolve({ code, out });
    });
    p.on("error", () => {
      clearTimeout(t);
      resolve({ code: null, out });
    });
  });
}

export interface ClaudeAuthStatus {
  authenticated: boolean;
  /** "assinatura" (login Claude), "api" (chave) ou "provedor" (Bedrock/Vertex). */
  method: "assinatura" | "api" | "provedor" | null;
  loginInProgress: boolean;
}

let cache: { at: number; value: Omit<ClaudeAuthStatus, "loginInProgress"> } | null = null;

export async function getClaudeAuthStatus(force = false): Promise<ClaudeAuthStatus> {
  const loginInProgress = Boolean(g.__isuClaudeLogin);
  if (!force && cache && Date.now() - cache.at < 5_000) return { ...cache.value, loginInProgress };
  let value: Omit<ClaudeAuthStatus, "loginInProgress">;
  if (process.env.ANTHROPIC_API_KEY) value = { authenticated: true, method: "api" };
  else if (process.env.CLAUDE_CODE_USE_BEDROCK || process.env.CLAUDE_CODE_USE_VERTEX) value = { authenticated: true, method: "provedor" };
  else {
    const { out } = await run(["auth", "status", "--json"], 8_000);
    let loggedIn = false;
    try {
      loggedIn = Boolean(JSON.parse(out.slice(out.indexOf("{"))).loggedIn);
    } catch {
      loggedIn = false;
    }
    value = { authenticated: loggedIn, method: loggedIn ? "assinatura" : null };
  }
  cache = { at: Date.now(), value };
  return { ...value, loginInProgress };
}

function endAttempt() {
  const a = g.__isuClaudeLogin;
  if (!a) return;
  clearTimeout(a.timer);
  a.proc.kill("SIGKILL");
  g.__isuClaudeLogin = null;
}

/** Inicia o login e devolve a URL que o usuário abre no navegador (com a conta que paga o Claude). */
export async function startClaudeLogin(): Promise<{ url: string }> {
  endAttempt();
  const proc = spawn(claudeBinary(), ["auth", "login", "--claudeai"], { env: { ...process.env, BROWSER: "true" }, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  const attempt: LoginAttempt = {
    proc,
    url: "",
    stderr: "",
    exited: new Promise((r) => proc.on("close", (c) => r(c))),
    timer: setTimeout(endAttempt, LOGIN_TTL_MS),
  };
  proc.stdout.on("data", (d) => (stdout += d));
  proc.stderr.on("data", (d) => (attempt.stderr += d));
  proc.on("error", () => undefined);
  g.__isuClaudeLogin = attempt;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && !attempt.url) {
    const m = stdout.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").match(/https:\/\/claude\.(?:com|ai)\/\S+/);
    if (m) attempt.url = m[0];
    else await new Promise((r) => setTimeout(r, 150));
  }
  if (!attempt.url) {
    endAttempt();
    throw new ValidationError("Não consegui iniciar o login do Claude neste servidor.");
  }
  return { url: attempt.url };
}

/** Entrega o código que a página do Claude mostrou. Sucesso só quando a CLI sai com 0 e o status confirma. */
export async function submitClaudeLoginCode(rawCode: string): Promise<void> {
  const code = rawCode.trim();
  if (!code || code.length > 600 || /\s/.test(code)) throw new ValidationError("Código inválido. Cole exatamente o código mostrado pelo Claude.");
  const attempt = g.__isuClaudeLogin;
  if (!attempt) throw new ValidationError("Nenhum login em andamento. Clique em “Entrar com minha conta Claude” de novo.");
  attempt.proc.stdin.write(`${code}\n`);
  const exit = await Promise.race([attempt.exited, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 45_000))]);
  const stderr = attempt.stderr;
  endAttempt();
  if (exit !== 0) {
    const reason = /Login failed:[^\n]*/.exec(stderr)?.[0];
    throw new ValidationError(reason ?? "O Claude não aceitou o código. Gere um novo clicando em “Entrar com minha conta Claude”.");
  }
  cache = null;
  if (!(await getClaudeAuthStatus(true)).authenticated) throw new ValidationError("O login terminou, mas o Claude não confirmou a sessão. Tente novamente.");
}

export async function claudeLogout(): Promise<void> {
  endAttempt();
  await run(["auth", "logout"], 10_000);
  cache = null;
}
