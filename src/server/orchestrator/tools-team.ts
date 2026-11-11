import { z } from "zod";
import { prisma } from "@/server/db/client";
import { createDeploymentProvider } from "@/server/providers/provider-registry";
import { redactSecrets } from "@/server/claude/agent-service";
import { extractErrorEvents, hashText } from "@/lib/error-logs";
import { describeSchedule } from "@/lib/clt-routines";
import { listErrorGroups } from "@/server/monitoring/error-collector";
import { DELEGATION_PRIORITIES, checkDelegation, resolveAgentRef } from "@/lib/clt-dashboard";
import { findDuplicate } from "@/lib/clt-team";
import { FINDING_CATEGORIES, FINDING_SEVERITIES, findingKey } from "@/lib/fix-queue";
import { agentBudget, windowStarts } from "./budget";
import { cltOverview } from "./clt";
import { listIncidents } from "./incidents";
import { ACTIVE, submitSystemTask } from "./service";
import { COMMERCIAL_MCP_TOOLS, commercialDef, COMMERCIAL_TEAM_ID, type CommercialSlug } from "@/lib/commercial-team";
import { commercialTools } from "./tools-commercial";

/**
 * Ferramentas da equipe CLT liberadas sem pedir aprovação. As de leitura não alteram nada; `delegar_tarefa` (só do ID Manager)
 * apenas ENFILEIRA uma tarefa para um colega — e passa pelas travas de `checkDelegation` (teto por execução e por dia, sem duplicata,
 * sem agente pausado ou sem orçamento de tokens).
 */
export const UNIVERSE_TEAM_TOOLS = ["listar_erros", "registrar_achado", "ler_logs", "status_equipe", "delegar_tarefa", "resultado_delegacoes", "descrever_produto"].map((n) => `mcp__universe__${n}`);

/** Ferramentas da equipe COMERCIAL liberadas sem aprovação: só leem/gravam o funil; nenhuma envia nada. */
export const UNIVERSE_COMMERCIAL_TOOLS = COMMERCIAL_MCP_TOOLS;

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) });
const fail = (e: unknown) => text(e instanceof Error ? e.message : "Falhou.", true);
const hhmm = (d: Date) => d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const MAX_REPLY = 14_000;
const cap = (s: string) => (s.length > MAX_REPLY ? `${s.slice(0, MAX_REPLY)}\n[… resposta cortada …]` : s);

type ToolFn = (name: string, description: string, shape: z.ZodRawShape, handler: (args: never) => Promise<ReturnType<typeof text>>) => unknown;

/**
 * Erros e logs dos sistemas para os agentes CLT investigarem de verdade (antes eles só viam o que vinha no pedido).
 * Tudo passa por `redactSecrets`; nenhuma ferramenta escreve nada.
 */
export async function teamTools(tool: ToolFn, agentId: string, taskId: string): Promise<unknown[]> {
  const agent = await prisma.agentProfile.findUnique({ where: { id: agentId }, select: { team: true, slug: true } });
  if (agent?.team === COMMERCIAL_TEAM_ID && agent.slug && commercialDef(agent.slug)) return commercialTools(tool, agentId, taskId, agent.slug as CommercialSlug);
  if (agent?.team !== "CLT") return [];

  const tools: unknown[] = [
    tool(
      "listar_erros",
      "Lista os erros que os sistemas escreveram nos logs (coletados a cada 15 min e já agrupados: o mesmo erro com horas/números diferentes é um item só), com quantas vezes ocorreu, quando apareceu pela primeira e pela última vez e a última ocorrência com o stack trace. Comece por aqui ao investigar um problema.",
      {
        sistema: z.string().max(80).optional().describe("Parte do nome do sistema/aplicação. Vazio = todos."),
        horas: z.number().int().min(1).max(720).optional().describe("Janela em horas (padrão 24)."),
        limite: z.number().int().min(1).max(30).optional().describe("Quantos grupos devolver (padrão 15)."),
      },
      (async (args: { sistema?: string; horas?: number; limite?: number }) => {
        try {
          const hours = args.horas ?? 24;
          const groups = await listErrorGroups({ hours, system: args.sistema, limit: args.limite ?? 15 });
          if (groups.length === 0) return text(`Nenhum erro registrado nas últimas ${hours} h${args.sistema ? ` para "${args.sistema}"` : ""}. (A coleta lê os logs a cada 15 min; erros que já estavam no fim do log na primeira leitura de um sistema não entram — use ler_logs para ver o log atual.)`);
          const body = groups
            .map((g) => `• ${g.project ? `${g.project} / ` : ""}${g.application} — ${g.count}× · primeira ${hhmm(new Date(g.firstSeenAt))} · última ${hhmm(new Date(g.lastSeenAt))}\n${g.sample.split("\n").map((l) => `    ${l.slice(0, 400)}`).join("\n")}`)
            .join("\n\n");
          return text(cap(`${groups.length} tipo(s) de erro nas últimas ${hours} h:\n\n${body}`));
        } catch (e) {
          return fail(e);
        }
      }) as never,
    ),
    tool(
      "ler_logs",
      "Lê o log de execução ATUAL de um sistema (últimas linhas, como o Coolify mostra agora). Use para ver o contexto de um erro de listar_erros. Segredos são mascarados.",
      {
        sistema: z.string().min(2).max(80).describe("Nome do sistema/aplicação (parte do nome basta se for única)."),
        linhas: z.number().int().min(20).max(400).optional().describe("Quantas linhas finais (padrão 150)."),
        somente_erros: z.boolean().optional().describe("Devolver só as linhas de erro com stack trace."),
      },
      (async (args: { sistema: string; linhas?: number; somente_erros?: boolean }) => {
        try {
          const matches = await prisma.application.findMany({ where: { name: { contains: args.sistema, mode: "insensitive" }, provider: { enabled: true } }, include: { provider: true }, take: 6 });
          const exact = matches.filter((m) => m.name.toLowerCase() === args.sistema.toLowerCase());
          const pick = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : null;
          if (!pick) return text(matches.length === 0 ? `Nenhum sistema com nome parecido com "${args.sistema}".` : `Mais de um sistema combina com "${args.sistema}": ${matches.map((m) => m.name).join(", ")}. Informe o nome completo.`, true);
          const logs = await createDeploymentProvider(pick.provider).getApplicationLogs(pick.externalId, pick.resourceType, { lines: args.linhas ?? 150 });
          const raw = logs.lines.map((l) => l.raw);
          const out = args.somente_erros ? extractErrorEvents(raw, 10).map((e) => [e.line, ...e.context].join("\n")).join("\n---\n") : raw.join("\n");
          return text(cap(`Log de ${pick.name} (${args.somente_erros ? "só erros" : `últimas ${raw.length} linhas`}):\n${redactSecrets(out) || "(sem linhas)"}`));
        } catch (e) {
          return fail(e);
        }
      }) as never,
    ),
    tool(
      "registrar_achado",
      "Registra na FILA DE CORREÇÃO do Italo qualquer coisa que você viu e que pode melhorar ou corrigir (vulnerabilidade, lentidão, falta de teste, dívida técnica, documentação desatualizada, risco de infraestrutura, índice faltando…) — não só erros de log. O Italo escolhe um item por vez e o ID Manager coordena a correção. Se a ação só o Italo pode fazer (credencial, painel de terceiro, autorização, remover dados em conta externa), use categoria 'acao-humana': ela aparece no topo da tela dele como 'Ação sua' e NÃO vai para o Manager. Registre só o que você VERIFICOU (arquivo/linha, medição ou trecho de log), um item por problema, com título específico. Repetir o mesmo achado só atualiza o existente.",
      {
        titulo: z.string().min(8).max(160).describe("Título específico (ex.: 'Rota /api/x sem checagem de empresa')."),
        detalhe: z.string().min(20).max(3000).describe("Evidência (arquivo/linha, medição, trecho de log) e a correção sugerida."),
        gravidade: z.enum(FINDING_SEVERITIES).describe("LOW, MEDIUM, HIGH ou CRITICAL (CRITICAL = dado exposto ou produção em risco)."),
        categoria: z.enum(FINDING_CATEGORIES).describe("Tipo do achado."),
        sistema: z.string().max(80).optional().describe("Nome do sistema afetado. Vazio = geral."),
      },
      (async (args: { titulo: string; detalhe: string; gravidade: (typeof FINDING_SEVERITIES)[number]; categoria: (typeof FINDING_CATEGORIES)[number]; sistema?: string }) => {
        try {
          const me = await prisma.agentProfile.findUnique({ where: { id: agentId }, select: { name: true } });
          const sys = args.sistema?.trim() || null;
          const data = { title: args.titulo.trim(), detail: redactSecrets(args.detalhe), severity: args.gravidade, category: args.categoria, applicationName: sys, agentName: me?.name ?? "Agente CLT" };
          const fingerprint = findingKey(sys, args.titulo);
          const existing = await prisma.agentFinding.findUnique({ where: { fingerprint }, select: { id: true } });
          await prisma.agentFinding.upsert({ where: { fingerprint }, create: { ...data, fingerprint }, update: { ...data, updatedAt: new Date() } });
          return text(existing ? "Achado já registrado: atualizei os dados (se já tinha sido tratado, voltou para a fila)." : "Achado registrado na fila de correção do Italo.");
        } catch (e) {
          return fail(e);
        }
      }) as never,
    ),
  ];

  if (agent.slug === "id-manager") {
    tools.push(
      tool(
        "delegar_tarefa",
        "Passa uma tarefa a um especialista da equipe (ID Guardian, ID Doctor, ID QA, ID Optimizer, ID DevOps ou ID Architect). Escreva a instrução completa e autossuficiente: o colega não vê esta conversa. Recusa duplicata, agente pausado e agente sem orçamento de tokens; máximo de 5 por execução. Depois use resultado_delegacoes para ver o que voltou.",
        {
          agente: z.string().min(2).max(60).describe("Nome ou slug do especialista (ex.: ID Doctor, id-doctor ou doctor)."),
          instrucao: z.string().min(15).max(4000).describe("O que fazer, com o contexto necessário e o que entregar."),
          prioridade: z.enum(["alta", "normal", "baixa"]).optional().describe("Ordem na fila (padrão normal). Alta só para produção fora do ar ou segurança."),
        },
        (async (args: { agente: string; instrucao: string; prioridade?: keyof typeof DELEGATION_PRIORITIES }) => {
          try {
            const team = await prisma.agentProfile.findMany({ where: { team: "CLT", archivedAt: null, slug: { not: null } }, select: { id: true, name: true, slug: true, paused: true, dailyTokenLimit: true, monthlyTokenLimit: true } });
            const named = team.map((a) => ({ id: a.id, name: a.name, slug: a.slug as string }));
            const hit = resolveAgentRef(args.agente, named);
            if (!hit) return text(`Agente "${args.agente}" não encontrado. Equipe: ${named.map((a) => a.name).join(", ")}.`, true);
            if ("ambiguous" in hit) return text(`"${args.agente}" combina com mais de um: ${hit.ambiguous.join(", ")}. Use o nome completo.`, true);
            const target = team.find((a) => a.id === hit.id)!;
            const prompt = `[Delegada pelo ID Manager] ${args.instrucao.trim()}`;
            const open = await prisma.agentTask.findMany({ where: { agent: { team: "CLT" }, status: { in: ["QUEUED", ...ACTIVE] } }, select: { prompt: true } });
            const [thisRun, today, budget] = await Promise.all([
              prisma.agentTask.count({ where: { parentTaskId: taskId } }),
              prisma.agentTask.count({ where: { parentTaskId: { not: null }, createdAt: { gte: windowStarts().day } } }),
              agentBudget(target.id, { dailyTokenLimit: target.dailyTokenLimit, monthlyTokenLimit: target.monthlyTokenLimit }),
            ]);
            const verdict = checkDelegation({ selfSlug: "id-manager", target: { slug: target.slug as string, paused: target.paused, archived: false }, duplicateOpen: Boolean(findDuplicate(prompt, open)), delegatedThisRun: thisRun, delegatedToday: today, budgetReason: budget.blocked ? budget.reason : null });
            if (!verdict.ok) return text(`Não delegada: ${verdict.reason}`, true);
            const { task, duplicate } = await submitSystemTask({ agentId: target.id, prompt, idempotencyKey: `delegate:${taskId}:${target.id}:${hashText(prompt)}`, priority: DELEGATION_PRIORITIES[args.prioridade ?? "normal"], parentTaskId: taskId });
            return text(duplicate ? `Esta delegação já tinha sido feita (tarefa ${task.id.slice(-6)}).` : `Delegada a ${target.name} (tarefa ${task.id.slice(-6)}, prioridade ${args.prioridade ?? "normal"}). Restam ${Math.max(0, 5 - thisRun - 1)} delegações nesta execução. Use resultado_delegacoes para acompanhar.`);
          } catch (e) {
            return fail(e);
          }
        }) as never,
      ),
      tool(
        "resultado_delegacoes",
        "Mostra as tarefas que o ID Manager delegou (nesta e em execuções anteriores): para quem foi, situação e o resultado. Use para consolidar o que voltou dos especialistas.",
        { horas: z.number().int().min(1).max(168).optional().describe("Janela em horas (padrão 48).") },
        (async (args: { horas?: number }) => {
          try {
            const hours = args.horas ?? 48;
            const rows = await prisma.agentTask.findMany({ where: { parentTaskId: { not: null }, createdAt: { gte: new Date(Date.now() - hours * 3600_000) } }, orderBy: { createdAt: "desc" }, take: 15, include: { agent: { select: { name: true } } } });
            if (rows.length === 0) return text(`Nenhuma tarefa delegada nas últimas ${hours} h.`);
            return text(cap(rows.map((t) => `• ${hhmm(t.createdAt)} → ${t.agent.name} [${t.status}] ${t.prompt.replace("[Delegada pelo ID Manager] ", "").replace(/\s+/g, " ").slice(0, 120)}\n    → ${t.status === "COMPLETED" ? (t.result ?? "(sem texto)").replace(/\s+/g, " ").slice(0, 500) : t.error ? t.error.slice(0, 200) : "(ainda sem resultado)"}`).join("\n")));
          } catch (e) {
            return fail(e);
          }
        }) as never,
      ),
      tool(
        "status_equipe",
        "Estado REAL da equipe AGENTES CLT agora: situação de cada agente, tarefas e tokens (dia/mês contra o limite), os últimos resultados e o que as rotinas fizeram. Use antes de qualquer resumo — nunca invente números.",
        { horas: z.number().int().min(1).max(168).optional().describe("Janela dos últimos resultados (padrão 24).") },
        (async (args: { horas?: number }) => {
          try {
            const hours = args.horas ?? 24;
            const since = new Date(Date.now() - hours * 3600_000);
            const [overview, recent, routines, errors, incidents] = await Promise.all([
              cltOverview(),
              prisma.agentTask.findMany({ where: { agent: { team: "CLT" }, finishedAt: { gte: since } }, orderBy: { finishedAt: "desc" }, take: 15, include: { agent: { select: { name: true } } } }),
              prisma.agentRoutine.findMany({ where: { agent: { team: "CLT", archivedAt: null } }, include: { agent: { select: { name: true } } }, orderBy: { time: "asc" } }),
              listErrorGroups({ hours, limit: 5 }),
              listIncidents(10),
            ]);
            const pct = (p: number | null) => (p === null ? "sem limite" : `${p}%`);
            const agents = overview.agents.map((a) => `• ${a.name} (${a.roleTitle ?? "—"}): ${a.state}${a.activity ? ` — ${a.activity}` : ""} · tarefas: ${a.tasks.running} rodando, ${a.tasks.pending} na fila, ${a.tasks.completed} concluídas, ${a.tasks.failed} falhas · tokens hoje ${a.usage.usedDay} (${pct(a.usage.dayPercent)}), mês ${a.usage.usedMonth} (${pct(a.usage.monthPercent)})${a.paused ? " · PAUSADO" : ""}`).join("\n");
            const results = recent.length
              ? recent.map((t) => `• ${t.finishedAt ? hhmm(t.finishedAt) : "?"} ${t.agent.name} [${t.status}] ${t.prompt.replace(/\s+/g, " ").slice(0, 100)}\n    → ${(t.result ?? t.error ?? "(sem resultado)").replace(/\s+/g, " ").slice(0, 300)}`).join("\n")
              : `(nenhuma tarefa terminou nas últimas ${hours} h)`;
            const routs = routines.map((r) => `• ${r.agent.name} — ${r.name} (${describeSchedule(r)}, ${r.enabled ? "ligada" : "desligada"}): ${r.lastRunAt ? `${hhmm(r.lastRunAt)} — ` : ""}${r.lastOutcome ?? "ainda não rodou"}`).join("\n");
            const sysErrors = errors.length
              ? errors.map((g) => `• ${g.application} — ${g.count}× · ${g.sample.split("\n")[0].slice(0, 160)}`).join("\n")
              : `(nenhum erro novo nos logs nas últimas ${hours} h)`;
            const openIncidents = incidents.filter((i) => i.status !== "RESOLVED");
            const incidentLines = openIncidents.length
              ? openIncidents.map((i) => `• ${i.application} — ${i.status === "ESCALATED" ? "PRECISA DE HUMANO" : "em conserto"} · tentativa ${i.attempts} · ${i.commit ?? "?"} ${i.commitMessage ?? ""}${i.culprit?.locked ? ` · agente ${i.culprit.name} bloqueado` : ""}`).join("\n")
              : "(nenhum incidente de deploy aberto)";
            return text(cap(`EQUIPE (${overview.totals.working} trabalhando, ${overview.totals.available} disponíveis, ${overview.totals.waiting} aguardando aprovação, ${overview.totals.errored} com erro) · tokens hoje ${overview.totals.tokensDay}, mês ${overview.totals.tokensMonth}\n\n${agents}\n\nRESULTADOS (${hours} h):\n${results}\n\nROTINAS:\n${routs}\n\nERROS DOS SISTEMAS (${hours} h, mais recentes):\n${sysErrors}\n\nINCIDENTES DE DEPLOY ABERTOS:\n${incidentLines}`));
          } catch (e) {
            return fail(e);
          }
        }) as never,
      ),
    );
  }
  // O catálogo que a equipe comercial lê é mantido por quem conhece o produto: Architect e Manager.
  if (agent.slug === "id-architect" || agent.slug === "id-manager") {
    tools.push(
      tool(
        "descrever_produto",
        "Cria ou atualiza a FICHA COMERCIAL de um produto (SaaS) da ID System, que a equipe Comercial & Marketing lê para não prometer o que não existe. Descreva só o que o produto FAZ de verdade hoje (verificado no código/documentação), em linguagem de cliente, sem segredos técnicos.",
        {
          produto: z.string().min(2).max(80).describe("Nome do produto (igual ao do projeto no Universe)."),
          resumo: z.string().min(20).max(600),
          funcionalidades: z.string().min(20).max(3000).describe("Lista do que existe hoje."),
          segmentos_ideais: z.string().max(400).optional(),
          observacao: z.string().max(600).optional().describe("Limites, o que ainda NÃO existe, pré-requisitos."),
        },
        (async (args: { produto: string; resumo: string; funcionalidades: string; segmentos_ideais?: string; observacao?: string }) => {
          try {
            const me = await prisma.agentProfile.findUnique({ where: { id: agentId }, select: { name: true } });
            const data = { summary: redactSecrets(args.resumo), features: redactSecrets(args.funcionalidades), idealSegments: args.segmentos_ideais ?? null, commercialNote: args.observacao ?? null, updatedBy: me?.name ?? "Equipe CLT" };
            await prisma.productProfile.upsert({ where: { name: args.produto.trim() }, create: { name: args.produto.trim(), ...data }, update: data });
            return text(`Ficha de "${args.produto.trim()}" salva. A equipe comercial já enxerga.`);
          } catch (e) {
            return fail(e);
          }
        }) as never,
      ),
    );
  }
  return tools;
}
