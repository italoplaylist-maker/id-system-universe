import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { getInstallationToken } from "@/server/github/github-api";
import { redactSecrets } from "@/server/claude/agent-service";
import { orchestratorBus } from "./bus";
import { gitEnv, remoteUrl } from "./git/git";
import { extraDir, listExtraRepos, pickAgentRepository } from "./repo-link";

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
const preparePrimary: WorkspacePreparer = async (agent, log) => {
  const profile = await prisma.agentProfile.findUnique({ where: { id: agent.id }, select: { githubRepositoryId: true, githubBranch: true, projectId: true } });
  const picked = profile ? await pickAgentRepository(profile) : null;
  if (existsSync(agent.cwd)) {
    // Já é uma cópia Git: nada a fazer. Pasta vazia (criada quando ainda não havia repositório) com repositório agora conectado: clona dentro dela.
    if (existsSync(join(agent.cwd, ".git"))) return;
    const entries = await readdir(agent.cwd).catch(() => ["?"]);
    if (entries.length > 0 || !picked) return;
  }
  const gh = picked?.gh;
  if (!gh || gh.archived) {
    await mkdir(agent.cwd, { recursive: true });
    await log("Workspace criado vazio: nenhum repositório GitHub conectado a este agente.");
    return;
  }
  await log(`Preparando workspace: clonando ${gh.fullName}…`);
  const token = await getInstallationToken(gh.installation.installationId);
  await mkdir(join(agent.cwd, ".."), { recursive: true });
  // O token vai por variável de ambiente do git (não aparece em argumentos nem fica gravado no .git/config).
  const env = gitEnv(token);
  const branchName = picked?.branch || null;
  const branch = branchName ? ["--branch", branchName] : [];
  const r = await git(["clone", "--depth", "50", ...branch, remoteUrl(gh.fullName), agent.cwd], env);
  if (r.code !== 0) {
    logger.warn("workspace_clone_failed", { agentId: agent.id });
    throw new Error(`Não consegui clonar ${gh.fullName}: ${redactSecrets(r.out).slice(-300)}`);
  }
  await log(`Workspace pronto (${gh.fullName}).`);
};

/** Clona (se faltar) cada repositório EXTRA do agente em <cwd>.extras/<dir>. Falha em um extra não impede a tarefa. */
async function prepareExtras(agent: { id: string; cwd: string }, log: Log): Promise<void> {
  for (const e of await listExtraRepos(agent.id)) {
    const dir = extraDir(agent.cwd, e.dir);
    try {
      if (existsSync(join(dir, ".git"))) continue;
      if (existsSync(dir) && (await readdir(dir).catch(() => ["?"])).length > 0) {
        await log(`Repositório extra ${e.githubRepository.fullName}: a pasta ${dir} já tem arquivos sem Git — não mexi.`);
        continue;
      }
      if (e.githubRepository.archived) continue;
      await log(`Preparando repositório extra: clonando ${e.githubRepository.fullName}…`);
      const token = await getInstallationToken(e.githubRepository.installation.installationId);
      await mkdir(join(dir, ".."), { recursive: true });
      const branch = e.branch ? ["--branch", e.branch] : [];
      const r = await git(["clone", "--depth", "50", ...branch, remoteUrl(e.githubRepository.fullName), dir], gitEnv(token));
      if (r.code !== 0) await log(`Não consegui clonar ${e.githubRepository.fullName}: ${redactSecrets(r.out).slice(-200)}`);
      else await log(`Repositório extra pronto (${e.githubRepository.fullName}).`);
    } catch (error) {
      await log(`Repositório extra ${e.githubRepository.fullName}: ${error instanceof Error ? redactSecrets(error.message) : "falhou"}`);
    }
  }
}

const defaultPreparer: WorkspacePreparer = async (agent, log) => {
  await preparePrimary(agent, log);
  await prepareExtras(agent, log);
};

/** Extras já clonados (com Git), prontos para o Claude enxergar. */
export async function loadExtraRepos(agentId: string, agentCwd: string): Promise<Array<{ dir: string; fullName: string; name: string }>> {
  const out: Array<{ dir: string; fullName: string; name: string }> = [];
  for (const e of await listExtraRepos(agentId)) {
    const dir = extraDir(agentCwd, e.dir);
    if (existsSync(join(dir, ".git"))) out.push({ dir, fullName: e.githubRepository.fullName, name: e.dir });
  }
  return out;
}

/** Prepara só os extras (usado logo depois de conectar um novo). */
export async function prepareExtrasNow(agentId: string): Promise<string> {
  const agent = await prisma.agentProfile.findUnique({ where: { id: agentId } });
  if (!agent) return "Agente não encontrado.";
  const notes: string[] = [];
  await prepareExtras(agent, async (t) => void notes.push(t));
  return notes.join(" ");
}

/**
 * Chamado logo depois de conectar um repositório ao agente: prepara a cópia sem esperar a próxima tarefa.
 * Pasta com arquivos mas sem Git (trabalho feito antes da conexão) NÃO é apagada: é movida para uma pasta de backup ao lado.
 */
export async function prepareAfterLink(agentId: string): Promise<{ ok: boolean; message: string }> {
  const agent = await prisma.agentProfile.findUnique({ where: { id: agentId } });
  if (!agent) return { ok: false, message: "Agente não encontrado." };
  const notes: string[] = [];
  const log: Log = async (t) => void notes.push(t);
  try {
    const picked = await pickAgentRepository(agent);
    let wrongRepo = false;
    if (picked && existsSync(join(agent.cwd, ".git"))) {
      const o = await git(["-C", agent.cwd, "remote", "get-url", "origin"], process.env);
      wrongRepo = o.code !== 0 || !o.out.toLowerCase().includes(picked.gh.fullName.toLowerCase());
    }
    if (existsSync(agent.cwd) && (!existsSync(join(agent.cwd, ".git")) || wrongRepo)) {
      const entries = await readdir(agent.cwd).catch(() => []);
      if (entries.length > 0) {
        const backup = `${agent.cwd}.antes-do-git-${Date.now()}`;
        await rename(agent.cwd, backup);
        notes.push(`${wrongRepo ? "A cópia anterior era de outro repositório." : "Havia arquivos na pasta sem Git."} Guardei tudo em ${backup} (fica 30 dias).`);
      }
    }
    await getWorkspacePreparer()({ id: agent.id, cwd: agent.cwd, projectId: agent.projectId }, log);
    await prisma.agentProfile.update({ where: { id: agentId }, data: { lastError: null } }).catch(() => undefined);
    return { ok: true, message: notes.join(" ") || "Pronto." };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.agentProfile.update({ where: { id: agentId }, data: { lastError: message.slice(0, 500) } }).catch(() => undefined);
    return { ok: false, message };
  }
}

const holder = globalThis as unknown as { __isuWorkspacePreparer?: WorkspacePreparer };
export function setWorkspacePreparer(p: WorkspacePreparer | null) {
  holder.__isuWorkspacePreparer = p ?? undefined;
}
export function getWorkspacePreparer(): WorkspacePreparer {
  return holder.__isuWorkspacePreparer ?? defaultPreparer;
}
