import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { getInstallationToken } from "@/server/github/github-api";
import { redactSecrets } from "@/server/claude/agent-service";
import { orchestratorBus } from "./bus";

/** Onde ficam as cópias de trabalho dos agentes no servidor do Universe. */
export function workspaceRoot(): string {
  return process.env.AGENTS_WORKSPACE_ROOT || join(homedir(), "workspaces");
}

/**
 * Cada Projeto do Universe ganha seu funcionário automaticamente (uma vez; quem foi removido de propósito não volta).
 * Só usa dados reais: nome e slug do projeto. O diretório é preparado (clone do GitHub vinculado) na primeira tarefa.
 */
export async function syncProjectAgents(): Promise<number> {
  const projects = await prisma.project.findMany({ where: { archivedAt: null, enabled: true }, orderBy: { createdAt: "asc" } });
  if (projects.length === 0) return 0;
  const existing = await prisma.agentProfile.findMany({ where: { projectId: { in: projects.map((p) => p.id) } }, select: { projectId: true } });
  const have = new Set(existing.map((e) => e.projectId));
  let created = 0;
  for (const p of projects) {
    if (have.has(p.id)) continue;
    const last = await prisma.agentProfile.aggregate({ _max: { position: true } });
    await prisma.agentProfile.create({
      data: { name: p.name.slice(0, 60), specialty: p.description?.slice(0, 120) ?? null, cwd: join(workspaceRoot(), p.slug), projectId: p.id, permissionMode: "default", position: (last._max.position ?? -1) + 1 },
    });
    created++;
  }
  if (created) orchestratorBus.emit({ type: "agent" });
  return created;
}

type Log = (text: string) => Promise<void>;
export type WorkspacePreparer = (agent: { id: string; cwd: string; projectId: string | null }, log: Log) => Promise<void>;

function git(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    let out = "";
    const p = spawn("git", args, { env, stdio: ["ignore", "pipe", "pipe"] });
    const t = setTimeout(() => p.kill("SIGKILL"), 10 * 60_000);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => (clearTimeout(t), resolve({ code, out })));
    p.on("error", (e) => (clearTimeout(t), resolve({ code: null, out: e.message })));
  });
}

/** Garante que o diretório do agente exista: clona o repositório GitHub vinculado ao projeto (via GitHub App) ou cria a pasta vazia. */
const defaultPreparer: WorkspacePreparer = async (agent, log) => {
  if (existsSync(agent.cwd)) return;
  const repo = agent.projectId
    ? await prisma.resourceRepository.findFirst({
        where: { application: { projectId: agent.projectId }, githubRepositoryId: { not: null } },
        include: { githubRepository: { include: { installation: true } } },
        orderBy: { createdAt: "asc" },
      })
    : null;
  const gh = repo?.githubRepository;
  if (!gh || gh.archived) {
    await mkdir(agent.cwd, { recursive: true });
    await log("Workspace criado vazio: nenhum repositório GitHub vinculado a este projeto.");
    return;
  }
  await log(`Preparando workspace: clonando ${gh.fullName}…`);
  const token = await getInstallationToken(gh.installation.installationId);
  await mkdir(join(agent.cwd, ".."), { recursive: true });
  // O token vai por variável de ambiente do git (não aparece em argumentos nem fica gravado no .git/config).
  const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_0: header };
  const branch = repo?.branch ? ["--branch", repo.branch] : [];
  const r = await git(["clone", "--depth", "50", ...branch, `https://github.com/${gh.fullName}.git`, agent.cwd], env);
  if (r.code !== 0) {
    logger.warn("workspace_clone_failed", { agentId: agent.id });
    throw new Error(`Não consegui clonar ${gh.fullName}: ${redactSecrets(r.out).slice(-300)}`);
  }
  await log(`Workspace pronto (${gh.fullName}).`);
};

const holder = globalThis as unknown as { __isuWorkspacePreparer?: WorkspacePreparer };
export function setWorkspacePreparer(p: WorkspacePreparer | null) {
  holder.__isuWorkspacePreparer = p ?? undefined;
}
export function getWorkspacePreparer(): WorkspacePreparer {
  return holder.__isuWorkspacePreparer ?? defaultPreparer;
}
