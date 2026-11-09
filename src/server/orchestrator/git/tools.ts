import { z } from "zod";
import { prisma } from "@/server/db/client";
import { cleanupWorkspace, getGitStatus, mergePullRequest, publishChanges, resolveAgentRepo } from "./ops";

export const UNIVERSE_TOOL_PREFIX = "mcp__universe__";
/** Sem pedir aprovação: abrir PR (seguro), ver estado e limpar a cópia (só apaga o que já foi enviado). Merge pede aprovação, a menos que o agente tenha a regra liberada. */
export const UNIVERSE_AUTO_ALLOWED = [`${UNIVERSE_TOOL_PREFIX}git_status`, `${UNIVERSE_TOOL_PREFIX}publish_changes`, `${UNIVERSE_TOOL_PREFIX}cleanup_workspace`];
export const UNIVERSE_MERGE_TOOL = `${UNIVERSE_TOOL_PREFIX}merge_pull_request`;

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) });
const fail = (e: unknown) => text(e instanceof Error ? e.message : "Falhou.", true);

/**
 * Ferramentas do Universe para o agente enviar o próprio trabalho ao GitHub. Rodam no servidor com o token do GitHub App:
 * o Claude nunca vê credencial, e toda regra de segurança (sem push na principal, sem segredos, merge só com CI verde) vive aqui.
 */
export async function buildUniverseMcp(agentId: string, taskId: string) {
  const { createSdkMcpServer, tool } = await import("@anthropic-ai/claude-agent-sdk");
  return createSdkMcpServer({
    name: "universe",
    version: "1.0.0",
    instructions: "Você NÃO tem credenciais de Git. Para levar seu trabalho ao GitHub use estas ferramentas: publish_changes (commit + push em branch própria + Pull Request), merge_pull_request (squash, só com verificações verdes) e cleanup_workspace.",
    tools: [
      tool("git_status", "Mostra o estado de uma cópia de trabalho (principal ou extra): branch, arquivos alterados, commits ainda não enviados e PRs abertos.", { repo: z.string().max(120).optional().describe("Qual repositório (nome da subpasta ou dono/nome). Vazio = o principal.") }, async (args) => {
        try {
          return text(JSON.stringify(await getGitStatus(agentId, { repo: args.repo }), null, 2));
        } catch (e) {
          return fail(e);
        }
      }),
      tool(
        "publish_changes",
        "Faz commit das suas alterações, envia para uma branch própria no GitHub e abre um Pull Request. Nunca envia direto para a branch principal. Use quando terminar uma mudança que deva ir para revisão/produção.",
        { title: z.string().max(200).optional().describe("Título do PR (padrão: o pedido da tarefa)"), body: z.string().max(5000).optional().describe("Descrição do PR: o que mudou e por quê"), repo: z.string().max(120).optional().describe("Qual repositório (nome da subpasta ou dono/nome). Vazio = o principal.") },
        async (args) => {
          try {
            const r = await publishChanges(agentId, { title: args.title, body: args.body, taskId, repo: args.repo });
            return text(`PR #${r.pullRequest.number} ${r.reused ? "atualizado" : "aberto"}: ${r.pullRequest.url} (branch ${r.branch}${r.committed ? ", novo commit" : ""}).`);
          } catch (e) {
            return fail(e);
          }
        },
      ),
      tool(
        "merge_pull_request",
        "Faz o merge (squash) de um PR seu na branch principal, o que dispara o deploy em produção. Só funciona com verificações verdes e sem conflito. Depois do merge a cópia de trabalho é apagada.",
        { number: z.number().int().positive().optional().describe("Número do PR (padrão: seu PR aberto mais recente)"), repo: z.string().max(120).optional().describe("Repositório do PR (nome da subpasta ou dono/nome). Vazio = qualquer um, o mais recente.") },
        async (args) => {
          try {
            const target = args.repo ? await resolveAgentRepo(agentId, args.repo) : null;
            const pr = await prisma.agentPullRequest.findFirst({ where: { agentId, status: "OPEN", ...(args.number ? { number: args.number } : {}), ...(target ? { repo: target.fullName } : {}) }, orderBy: { createdAt: "desc" } });
            if (!pr) return text("Não há PR seu aberto para mergear. Use publish_changes primeiro.", true);
            const r = await mergePullRequest(pr.id);
            return text(`PR #${r.number} mergeado. ${r.cleanup.removed ? "Cópia de trabalho apagada." : `Cópia mantida: ${r.cleanup.reason ?? ""}`}`);
          } catch (e) {
            return fail(e);
          }
        },
      ),
      tool("cleanup_workspace", "Apaga uma cópia de trabalho (principal ou extra) para liberar disco. Só apaga se tudo já foi enviado ao GitHub e você não tem outra tarefa na fila; senão explica por que manteve.", { repo: z.string().max(120).optional().describe("Qual repositório (nome da subpasta ou dono/nome). Vazio = o principal.") }, async (args) => {
        try {
          const r = await cleanupWorkspace(agentId, { repo: args.repo });
          return text(r.removed ? "Cópia apagada." : `Cópia mantida: ${r.reason ?? ""}`);
        } catch (e) {
          return fail(e);
        }
      }),
    ],
  });
}
