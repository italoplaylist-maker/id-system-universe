import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { redactSecrets } from "@/server/claude/agent-service";
import { recordAuditEvent } from "@/server/audit/audit-log";
import { getInstallationToken } from "@/server/github/github-api";
import { notify } from "@/server/notifications/notify";
import { orchestratorBus } from "../bus";
import { ghFetch, getInstallationPermissions, missingWritePermissions } from "./github-client";
import { cleanOut, gitEnv, isInsideWorkspaceRoot, runGit } from "./git";

/**
 * Operações de Git/GitHub dos agentes. Regras que valem em TODO caminho (ferramenta do agente, botão do painel):
 * - nunca push direto na branch principal: sempre branch própria + Pull Request;
 * - sem `--force`; o token do App só no ambiente do git;
 * - nada de .env/chaves/segredos no commit (barrado antes de commitar);
 * - merge só com verificações verdes e sem conflito; squash;
 * - a cópia só é apagada com tudo enviado e dentro da pasta de trabalhos dos agentes.
 */

const PROTECTED = new Set(["main", "master", "develop", "production", "prod", "release"]);
const FORBIDDEN_FILE = /(^|\/)(\.env(\.(?!example|sample|template)[^/]*)?|id_rsa[^/]*|id_ed25519[^/]*|[^/]+\.(pem|key|p12|pfx))$/i;
export const MERGE_METHOD = "squash" as const;

/** Chaves reais no que vai ser commitado: tokens com prefixo conhecido, Bearer longo e blocos de chave privada. (Mais estreito que o redactSecrets de propósito: `key={i}` e `maxTokens=5` são código normal.) */
const COMMIT_SECRET = /(\b(?:sk-ant|sk|ghp|gho|ghs|github_pat|xox[abp]|AKIA)[-_][A-Za-z0-9_\-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._\-]{24,})/;
export function diffHasSecret(diff: string): boolean {
  return diff.split("\n").some((l) => l.startsWith("+") && !l.startsWith("+++") && COMMIT_SECRET.test(l));
}

export interface AgentRepo {
  agent: { id: string; name: string; cwd: string; projectId: string | null };
  fullName: string;
  baseBranch: string;
  installationId: string;
}

export async function resolveAgentRepo(agentId: string): Promise<AgentRepo> {
  const agent = await prisma.agentProfile.findUnique({ where: { id: agentId } });
  if (!agent || agent.archivedAt) throw new NotFoundError("Agente não encontrado.");
  const link = agent.projectId
    ? await prisma.resourceRepository.findFirst({
        where: { application: { projectId: agent.projectId }, githubRepositoryId: { not: null } },
        include: { githubRepository: { include: { installation: true } } },
        orderBy: { createdAt: "asc" },
      })
    : null;
  const gh = link?.githubRepository;
  if (!gh || gh.archived) throw new ValidationError("Este agente não tem um repositório GitHub vinculado (o projeto precisa ter um recurso ligado a um repositório).");
  return { agent: { id: agent.id, name: agent.name, cwd: agent.cwd, projectId: agent.projectId }, fullName: gh.fullName, baseBranch: link?.branch || gh.defaultBranch || "main", installationId: gh.installation.installationId };
}

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "agente";
const firstLine = (s: string, n = 72) => s.replace(/\s+/g, " ").trim().slice(0, n);

export interface WorkspaceGitStatus {
  hasRepo: boolean;
  repo: string | null;
  baseBranch: string | null;
  workspaceExists: boolean;
  branch: string | null;
  changedFiles: number;
  unpushedCommits: number;
  /** Permissões que faltam no GitHub App para o agente publicar (vazio = tudo certo). */
  missingPermissions: string[];
  permissionsChecked: boolean;
  pullRequests: Array<{ id: string; number: number; url: string; title: string; status: string; branch: string }>;
}

export async function getGitStatus(agentId: string, opts: { checkPermissions?: boolean } = {}): Promise<WorkspaceGitStatus> {
  const agent = await prisma.agentProfile.findUnique({ where: { id: agentId } });
  if (!agent || agent.archivedAt) throw new NotFoundError("Agente não encontrado.");
  const prs = await prisma.agentPullRequest.findMany({ where: { agentId }, orderBy: { createdAt: "desc" }, take: 8 });
  const base: WorkspaceGitStatus = {
    hasRepo: false, repo: null, baseBranch: null, workspaceExists: existsSync(agent.cwd), branch: null, changedFiles: 0, unpushedCommits: 0,
    missingPermissions: [], permissionsChecked: false,
    pullRequests: prs.map((p) => ({ id: p.id, number: p.number, url: p.url, title: p.title, status: p.status, branch: p.branch })),
  };
  let repo: AgentRepo;
  try {
    repo = await resolveAgentRepo(agentId);
  } catch {
    return base;
  }
  base.hasRepo = true;
  base.repo = repo.fullName;
  base.baseBranch = repo.baseBranch;
  if (opts.checkPermissions) {
    try {
      base.missingPermissions = missingWritePermissions(await getInstallationPermissions(repo.installationId));
      base.permissionsChecked = true;
    } catch {
      base.permissionsChecked = false;
    }
  }
  if (base.workspaceExists && (await isInsideWorkspaceRoot(agent.cwd))) {
    const br = await runGit(agent.cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (br.code === 0) base.branch = br.out.trim();
    const st = await runGit(agent.cwd, ["status", "--porcelain"]);
    if (st.code === 0) base.changedFiles = st.out.split("\n").filter(Boolean).length;
    base.unpushedCommits = await countUnpushed(agent.cwd, base.branch, repo.baseBranch);
  }
  return base;
}

async function countUnpushed(cwd: string, branch: string | null, base: string): Promise<number> {
  // commits que ainda não estão no GitHub: contra a própria branch no remoto, ou contra a base se ela ainda não foi enviada
  if (branch && branch !== "HEAD") {
    const own = await runGit(cwd, ["rev-list", "--count", `origin/${branch}..HEAD`]);
    if (own.code === 0) return Number(own.out.trim()) || 0;
  }
  const vsBase = await runGit(cwd, ["rev-list", "--count", `origin/${base}..HEAD`]);
  return vsBase.code === 0 ? Number(vsBase.out.trim()) || 0 : 0;
}

export interface PublishInput {
  title?: string;
  body?: string;
  taskId?: string | null;
  /** Quem pediu (painel); ausente = o próprio agente. */
  actorUserId?: string | null;
}

export interface PublishResult {
  branch: string;
  pullRequest: { id: string; number: number; url: string; title: string };
  committed: boolean;
  reused: boolean;
}

export async function publishChanges(agentId: string, input: PublishInput = {}): Promise<PublishResult> {
  const repo = await resolveAgentRepo(agentId);
  const missing = missingWritePermissions(await getInstallationPermissions(repo.installationId));
  if (missing.length > 0) {
    throw new ValidationError(`O GitHub App do Universe ainda não pode escrever neste repositório. Em GitHub → Settings → Developer settings → GitHub Apps → seu App → Permissions, defina: ${missing.join(" e ")}. Depois aceite a atualização na instalação.`);
  }
  const cwd = repo.agent.cwd;
  if (!existsSync(cwd) || !(await isInsideWorkspaceRoot(cwd))) throw new ValidationError("A cópia de trabalho deste agente não existe (ou está fora da pasta dos agentes). Rode uma tarefa para ela ser preparada.");
  const token = await getInstallationToken(repo.installationId);
  const identity = { name: `${repo.agent.name} (ID System Universe)`, email: "universe-agent@users.noreply.github.com" };
  const env = gitEnv(token, identity);

  const cur = await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (cur.code !== 0) throw new ValidationError("A pasta do agente não é um repositório Git.");
  let branch = cur.out.trim();
  const dirty = (await runGit(cwd, ["status", "--porcelain"])).out.split("\n").filter(Boolean).length > 0;
  const ahead = await countUnpushed(cwd, branch, repo.baseBranch);
  if (!dirty && ahead === 0) throw new ValidationError("Não há nada para enviar: nenhuma alteração nem commit novo.");

  const onProtected = PROTECTED.has(branch) || branch === repo.baseBranch || branch === "HEAD";
  if (onProtected) {
    branch = `agente/${slug(repo.agent.name)}/${(input.taskId ?? Date.now().toString(36)).slice(-8)}`;
    const co = await runGit(cwd, ["checkout", "-b", branch]);
    if (co.code !== 0) throw new ValidationError(`Não consegui criar a branch ${branch}: ${cleanOut(co.out)}`);
  }
  if (PROTECTED.has(branch) || branch === repo.baseBranch) throw new ValidationError("Recusado: nunca envio direto para a branch principal.");

  const title = firstLine(input.title ?? (input.taskId ? ((await prisma.agentTask.findUnique({ where: { id: input.taskId }, select: { prompt: true } }))?.prompt ?? "") : "") ?? "") || `Alterações de ${repo.agent.name}`;
  let committed = false;
  if (dirty) {
    const add = await runGit(cwd, ["add", "-A"]);
    if (add.code !== 0) throw new ValidationError(`git add falhou: ${cleanOut(add.out)}`);
    const names = (await runGit(cwd, ["diff", "--cached", "--name-only"])).out.split("\n").filter(Boolean);
    const bad = names.filter((n) => FORBIDDEN_FILE.test(n));
    const diff = (await runGit(cwd, ["diff", "--cached", "--unified=0"])).out.slice(0, 2_000_000);
    const leaks = diffHasSecret(diff);
    if (bad.length > 0 || leaks) {
      await runGit(cwd, ["reset", "-q"]);
      throw new ValidationError(bad.length > 0 ? `Recusado: arquivos sensíveis no commit (${bad.slice(0, 3).join(", ")}). Remova-os ou coloque no .gitignore.` : "Recusado: o diff parece conter uma chave/segredo. Remova antes de enviar.");
    }
    const msg = `${title}\n\nAlterações feitas pelo agente ${repo.agent.name} (ID System Universe).`;
    const cm = await runGit(cwd, ["commit", "-m", msg], env);
    if (cm.code !== 0) throw new ValidationError(`git commit falhou: ${cleanOut(cm.out)}`);
    committed = true;
  }

  const push = await runGit(cwd, ["push", "-u", "origin", `HEAD:refs/heads/${branch}`], env);
  if (push.code !== 0) throw new ValidationError(`git push falhou: ${cleanOut(push.out)}`);

  const owner = repo.fullName.split("/")[0];
  const existing = await ghFetch<Array<{ number: number; html_url: string; title: string }>>(repo.installationId, "GET", `/repos/${repo.fullName}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open`);
  let pr = Array.isArray(existing.data) ? existing.data[0] : undefined;
  const reused = !!pr;
  if (!pr) {
    const created = await ghFetch<{ number: number; html_url: string; title: string; message?: string }>(repo.installationId, "POST", `/repos/${repo.fullName}/pulls`, {
      title,
      head: branch,
      base: repo.baseBranch,
      body: input.body?.slice(0, 5000) || `Alterações feitas pelo agente **${repo.agent.name}** no ID System Universe.`,
    });
    if (created.status !== 201 && created.status !== 200) throw new ValidationError(`O GitHub não abriu o PR (${created.status}): ${redactSecrets(created.data?.message ?? "erro")}`);
    pr = created.data;
  }
  const row = await prisma.agentPullRequest.upsert({
    where: { repo_number: { repo: repo.fullName, number: pr.number } },
    create: { agentId, taskId: input.taskId ?? null, repo: repo.fullName, number: pr.number, url: pr.html_url, branch, baseBranch: repo.baseBranch, title: pr.title ?? title },
    update: { status: "OPEN", url: pr.html_url },
  });
  await recordAuditEvent({ userId: input.actorUserId ?? undefined, action: "AGENT_GIT_PUBLISHED", status: "SUCCESS", entityType: "AgentPullRequest", entityId: row.id, metadata: { agentId, repo: repo.fullName, branch, number: pr.number, committed, reused } });
  orchestratorBus.emit({ type: "agent", agentId });
  void notify({ kind: "agent", level: "info", title: `${repo.agent.name} abriu o PR #${pr.number}`, body: row.title, url: pr.html_url, tag: `agent-pr:${row.id}`, audience: { permission: "provider:read", requireGlobal: true } });
  return { branch, pullRequest: { id: row.id, number: pr.number, url: pr.html_url, title: row.title }, committed, reused };
}

interface PullInfo {
  state: string;
  merged: boolean;
  mergeable: boolean | null;
  mergeable_state?: string;
  head: { sha: string; ref: string };
}

/** As verificações do commit estão todas verdes? (check-runs + status clássico). Sem nenhuma verificação configurada = nada a esperar. */
async function checksVerdict(installationId: string, repo: string, sha: string): Promise<{ ok: boolean; reason?: string }> {
  const runs = await ghFetch<{ check_runs?: Array<{ name: string; status: string; conclusion: string | null }> }>(installationId, "GET", `/repos/${repo}/commits/${sha}/check-runs?per_page=100`);
  for (const r of runs.data?.check_runs ?? []) {
    if (r.status !== "completed") return { ok: false, reason: `a verificação "${r.name}" ainda está rodando` };
    if (!["success", "neutral", "skipped"].includes(r.conclusion ?? "")) return { ok: false, reason: `a verificação "${r.name}" falhou (${r.conclusion})` };
  }
  const st = await ghFetch<{ state?: string; total_count?: number }>(installationId, "GET", `/repos/${repo}/commits/${sha}/status`);
  if ((st.data?.total_count ?? 0) > 0 && st.data?.state !== "success") return { ok: false, reason: `o status do commit está "${st.data?.state}"` };
  return { ok: true };
}

export interface MergeResult {
  merged: boolean;
  number: number;
  cleanup: { removed: boolean; reason?: string };
}

export async function mergePullRequest(prId: string, opts: { actorUserId?: string | null } = {}): Promise<MergeResult> {
  const row = await prisma.agentPullRequest.findUnique({ where: { id: prId }, include: { agent: true } });
  if (!row) throw new NotFoundError("PR não encontrado.");
  const repo = await resolveAgentRepo(row.agentId);
  const missing = missingWritePermissions(await getInstallationPermissions(repo.installationId));
  if (missing.length > 0) throw new ValidationError(`O GitHub App precisa das permissões: ${missing.join(" e ")}.`);

  let pull: PullInfo | null = null;
  for (let i = 0; i < 4; i += 1) {
    const r = await ghFetch<PullInfo>(repo.installationId, "GET", `/repos/${row.repo}/pulls/${row.number}`);
    if (r.status === 404) throw new ValidationError("O GitHub não encontrou este PR (foi apagado?).");
    pull = r.data;
    if (pull.mergeable !== null || pull.merged) break;
    await new Promise((res) => setTimeout(res, 1500)); // o GitHub ainda calcula se há conflito
  }
  if (!pull) throw new ValidationError("Não consegui ler o PR no GitHub.");
  if (pull.merged) {
    await prisma.agentPullRequest.update({ where: { id: prId }, data: { status: "MERGED", mergedAt: new Date() } });
    return { merged: true, number: row.number, cleanup: await cleanupWorkspace(row.agentId) };
  }
  if (pull.state !== "open") {
    await prisma.agentPullRequest.update({ where: { id: prId }, data: { status: "CLOSED" } });
    throw new ValidationError("Este PR foi fechado sem merge.");
  }
  if (pull.mergeable === false || pull.mergeable_state === "dirty") throw new ValidationError("O PR tem conflito com a branch principal. Resolva o conflito antes do merge.");
  const verdict = await checksVerdict(repo.installationId, row.repo, pull.head.sha);
  if (!verdict.ok) throw new ValidationError(`Merge recusado: ${verdict.reason}. Tente de novo quando as verificações estiverem verdes.`);

  const merge = await ghFetch<{ merged?: boolean; message?: string }>(repo.installationId, "PUT", `/repos/${row.repo}/pulls/${row.number}/merge`, { merge_method: MERGE_METHOD, commit_title: `${row.title} (#${row.number})` });
  if (merge.status !== 200 || !merge.data?.merged) throw new ValidationError(`O GitHub recusou o merge (${merge.status}): ${redactSecrets(merge.data?.message ?? "sem detalhe")}`);

  await prisma.agentPullRequest.update({ where: { id: prId }, data: { status: "MERGED", mergedAt: new Date() } });
  await recordAuditEvent({ userId: opts.actorUserId ?? undefined, action: "AGENT_PR_MERGED", status: "SUCCESS", entityType: "AgentPullRequest", entityId: prId, metadata: { agentId: row.agentId, repo: row.repo, number: row.number, method: MERGE_METHOD } });
  void notify({ kind: "agent", level: "success", title: `PR #${row.number} mergeado`, body: `${row.title} — o deploy automático deve começar em instantes.`, url: row.url, tag: `agent-pr:${row.id}`, audience: { permission: "provider:read", requireGlobal: true } });

  // limpeza: a branch remota (best-effort) e a cópia local (só se tudo estiver enviado)
  const cleanup = await cleanupWorkspace(row.agentId);
  await ghFetch(repo.installationId, "DELETE", `/repos/${row.repo}/git/refs/heads/${row.branch}`).catch(() => undefined);
  orchestratorBus.emit({ type: "agent", agentId: row.agentId });
  return { merged: true, number: row.number, cleanup };
}

/** Apaga a cópia de trabalho do agente. Só com tudo enviado, sem tarefa em andamento/na fila e dentro da pasta dos agentes. */
export async function cleanupWorkspace(agentId: string, opts: { actorUserId?: string | null } = {}): Promise<{ removed: boolean; reason?: string }> {
  const agent = await prisma.agentProfile.findUnique({ where: { id: agentId } });
  if (!agent) throw new NotFoundError("Agente não encontrado.");
  if (!existsSync(agent.cwd)) return { removed: false, reason: "A cópia já não existe." };
  if (!(await isInsideWorkspaceRoot(agent.cwd))) return { removed: false, reason: "O diretório deste agente está fora da pasta de trabalhos dos agentes: não vou apagá-lo." };
  const busy = await prisma.agentTask.count({ where: { agentId, status: { in: ["QUEUED", "STARTING", "RUNNING", "WAITING_APPROVAL"] } } });
  if (busy > 0) return { removed: false, reason: "O agente tem tarefa em andamento ou na fila: mantive a cópia." };

  const st = await runGit(agent.cwd, ["status", "--porcelain"]);
  if (st.code !== 0) return { removed: false, reason: "Não consegui verificar o estado do Git: mantive a cópia." };
  if (st.out.trim()) return { removed: false, reason: "Há alterações sem commit: mantive a cópia para não perder trabalho." };
  const br = (await runGit(agent.cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).out.trim();
  const repoInfo = await resolveAgentRepo(agentId).catch(() => null);
  const unpushed = await countUnpushed(agent.cwd, br, repoInfo?.baseBranch ?? "main");
  if (unpushed > 0) return { removed: false, reason: `Há ${unpushed} commit(s) que não foram para o GitHub: mantive a cópia.` };

  await rm(agent.cwd, { recursive: true, force: true });
  await recordAuditEvent({ userId: opts.actorUserId ?? undefined, action: "AGENT_WORKSPACE_CLEANED", status: "SUCCESS", entityType: "AgentProfile", entityId: agentId, metadata: { agentId } });
  logger.info("agent_workspace_cleaned", { agentId });
  orchestratorBus.emit({ type: "agent", agentId });
  return { removed: true };
}
