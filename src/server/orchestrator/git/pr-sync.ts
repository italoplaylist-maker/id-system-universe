import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { decidePrAction, type GithubPullState } from "@/lib/pr-sync";
import { orchestratorBus } from "../bus";
import { resolveAgentRepo } from "./ops";
import { ghFetch } from "./github-client";

/** Um PR mudou no GitHub (webhook): o Universe acompanha na hora. */
export async function applyPullRequestStatus(repo: string, number: number, status: "OPEN" | "MERGED" | "CLOSED"): Promise<boolean> {
  const row = await prisma.agentPullRequest.findUnique({ where: { repo_number: { repo, number } }, select: { id: true, status: true, agentId: true } });
  if (!row || row.status === status) return false;
  await prisma.agentPullRequest.update({ where: { id: row.id }, data: { status, ...(status === "MERGED" ? { mergedAt: new Date() } : {}) } });
  orchestratorBus.emit({ type: "agent", agentId: row.agentId });
  return true;
}

/**
 * Rede de segurança do webhook: confere no GitHub cada PR que o Universe ainda tem como aberto. Atualiza os que já foram mergeados/fechados
 * por fora e FECHA (com comentário) os ultrapassados: PR mais novo na mesma branch, ou branch sem nada a mergear (já está na principal).
 */
export async function reconcileOpenPullRequests(): Promise<{ checked: number; updated: number; closed: number }> {
  const rows = await prisma.agentPullRequest.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "asc" }, take: 30 });
  let updated = 0;
  let closed = 0;
  for (const row of rows) {
    try {
      const repo = await resolveAgentRepo(row.agentId, row.repo);
      const r = await ghFetch<GithubPullState & { base?: { ref: string }; head?: { ref: string } }>(repo.installationId, "GET", `/repos/${row.repo}/pulls/${row.number}`);
      const pull: GithubPullState | null = r.status === 404 ? null : r.status === 200 ? r.data : undefined!;
      if (pull === undefined) continue; // erro do GitHub: tenta na próxima rodada
      let compareStatus: string | null = null;
      let newerSameBranch = false;
      if (pull && !pull.merged && pull.state === "open") {
        newerSameBranch = (await prisma.agentPullRequest.count({ where: { agentId: row.agentId, repo: row.repo, branch: row.branch, number: { gt: row.number } } })) > 0;
        if (!newerSameBranch) {
          const c = await ghFetch<{ status?: string }>(repo.installationId, "GET", `/repos/${row.repo}/compare/${encodeURIComponent(row.baseBranch)}...${encodeURIComponent(row.branch)}`);
          compareStatus = c.status === 200 ? (c.data.status ?? null) : null;
        }
      }
      const action = decidePrAction({ pull, newerSameBranch, compareStatus });
      if (action.kind === "keep") continue;
      if (action.kind === "close") {
        await ghFetch(repo.installationId, "POST", `/repos/${row.repo}/issues/${row.number}/comments`, { body: `${action.reason} Fechado automaticamente pelo ID System Universe.` }).catch(() => undefined);
        const patch = await ghFetch(repo.installationId, "PATCH", `/repos/${row.repo}/pulls/${row.number}`, { state: "closed" });
        if (patch.status !== 200) continue;
        await prisma.agentPullRequest.update({ where: { id: row.id }, data: { status: "CLOSED" } });
        closed += 1;
      } else {
        await prisma.agentPullRequest.update({ where: { id: row.id }, data: { status: action.status, ...(action.status === "MERGED" ? { mergedAt: new Date() } : {}) } });
        updated += 1;
      }
      logger.info("agent_pr_reconciled", { repo: row.repo, number: row.number, action: action.kind, reason: "reason" in action ? action.reason : undefined });
      orchestratorBus.emit({ type: "agent", agentId: row.agentId });
    } catch (error) {
      logger.warn("agent_pr_reconcile_failed", { repo: row.repo, number: row.number, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { checked: rows.length, updated, closed };
}
