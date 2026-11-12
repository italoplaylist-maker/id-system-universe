import { z } from "zod";
import { prisma } from "@/server/db/client";
import { redactSecrets } from "@/server/claude/agent-service";
import { notify } from "@/server/notifications/notify";
import {
  COMMERCIAL_TOOLS_BY_SLUG, INTERACTION_CHANNELS, LEAD_PRIORITIES, LEAD_SEGMENTS, LEAD_STAGE_IDS, SEGMENT_LABEL, funnelMetrics, isStale, leadKeys, priorityLabel, stageLabel, type CommercialSlug,
} from "@/lib/commercial-team";
import { getCommercialSettings } from "./commercial";

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) });
const fail = (e: unknown) => text(e instanceof Error ? e.message : "Falhou.", true);
const MAX_REPLY = 12_000;
const cap = (s: string) => (s.length > MAX_REPLY ? `${s.slice(0, MAX_REPLY)}\n[… cortado …]` : s);
const clean = (s: string | undefined | null, n: number) => (s ? redactSecrets(s).replace(/\s+/g, " ").trim().slice(0, n) : null);

type ToolFn = (name: string, description: string, shape: z.ZodRawShape, handler: (args: never) => Promise<ReturnType<typeof text>>) => unknown;

/** Estágios que um agente nunca decide sozinho: o fato (contato, negócio fechado, perda) vem do Italo. */
const HUMAN_ONLY_STAGES = ["CONVERTIDO", "PERDIDO"];
const NEEDS_REAL_CONTACT = ["PRIMEIRO_CONTATO", "EM_NEGOCIACAO"];

/**
 * Ferramentas da equipe COMERCIAL. Todas rodam no servidor, gravam só no funil (Lead) e NENHUMA envia mensagem: abordagem é rascunho
 * que espera o Italo. Cada cargo recebe só as suas (COMMERCIAL_TOOLS_BY_SLUG).
 */
export async function commercialTools(tool: ToolFn, agentId: string, taskId: string, slug: CommercialSlug): Promise<unknown[]> {
  const me = await prisma.agentProfile.findUnique({ where: { id: agentId }, select: { name: true } });
  const agentName = me?.name ?? "Agente comercial";
  const mine = new Set(COMMERCIAL_TOOLS_BY_SLUG[slug] ?? []);
  const defs: Array<[string, unknown]> = [];
  const add = (name: string, description: string, shape: z.ZodRawShape, handler: (args: never) => Promise<ReturnType<typeof text>>) => {
    if (mine.has(name)) defs.push([name, tool(name, description, shape, handler)]);
  };

  add("configuracao_prospeccao", "Lê a configuração da prospecção definida pelo Italo: cidade-base, raio em km, segmentos e quantos leads novos você pode registrar por execução. Respeite-a.", {}, (async () => {
    try {
      const s = await getCommercialSettings();
      return text(`Cidade-base: ${s.baseCity}\nRaio: ${s.radiusKm} km\nSegmentos: ${s.segments.map((x) => SEGMENT_LABEL[x] ?? x).join(", ")}\nLimite de leads novos por execução: ${s.maxNewLeadsPerRun}`);
    } catch (e) {
      return fail(e);
    }
  }) as never);

  add("consultar_produtos", "Catálogo REAL dos produtos (SaaS) da ID System: resumo, funcionalidades, segmentos ideais e quais sistemas existem no Universe. Só ofereça o que está aqui; se o catálogo estiver vazio ou incompleto, diga isso (a equipe técnica o mantém).", { busca: z.string().max(80).optional().describe("Parte do nome do produto.") }, (async (args: { busca?: string }) => {
    try {
      const [profiles, projects] = await Promise.all([
        prisma.productProfile.findMany({ where: args.busca ? { name: { contains: args.busca, mode: "insensitive" } } : {}, orderBy: { name: "asc" }, take: 30 }),
        prisma.project.findMany({ where: { archivedAt: null, enabled: true, ...(args.busca ? { name: { contains: args.busca, mode: "insensitive" } } : {}) }, select: { name: true, description: true, resources: { select: { status: true } } }, orderBy: { name: "asc" }, take: 40 }),
      ]);
      const described = new Set(profiles.map((p) => p.name.toLowerCase()));
      const lines = profiles.map((p) => `• ${p.name}\n  Resumo: ${p.summary}\n  Funcionalidades: ${p.features}${p.idealSegments ? `\n  Segmentos ideais: ${p.idealSegments}` : ""}${p.commercialNote ? `\n  Observação comercial: ${p.commercialNote}` : ""}`);
      const bare = projects.filter((p) => !described.has(p.name.toLowerCase())).map((p) => `• ${p.name} — ${p.description ?? "sem descrição"} (${p.resources.filter((r) => r.status === "RUNNING").length}/${p.resources.length} no ar). SEM ficha comercial: não detalhe funcionalidades.`);
      if (lines.length + bare.length === 0) return text("Catálogo vazio: nenhum produto descrito. Diga isso no seu relatório; não invente funcionalidades. A equipe técnica (ID Architect) mantém as fichas.");
      return text(cap([...lines, ...(bare.length ? ["", "Sistemas existentes sem ficha comercial:", ...bare] : [])].join("\n")));
    } catch (e) {
      return fail(e);
    }
  }) as never);

  add("listar_leads", "Lista leads do funil (mais recentes primeiro) com etapa, prioridade e origem. Use para evitar duplicata e para achar o que precisa da sua ação.", {
    etapa: z.enum(LEAD_STAGE_IDS).optional(), segmento: z.string().max(40).optional(), busca: z.string().max(80).optional().describe("Parte do nome da empresa."), limite: z.number().int().min(1).max(40).optional(),
  }, (async (args: { etapa?: string; segmento?: string; busca?: string; limite?: number }) => {
    try {
      const rows = await prisma.lead.findMany({
        where: { discarded: false, ...(args.etapa ? { stage: args.etapa } : {}), ...(args.segmento ? { segment: args.segmento } : {}), ...(args.busca ? { name: { contains: args.busca, mode: "insensitive" } } : {}) },
        orderBy: { updatedAt: "desc" }, take: args.limite ?? 20,
      });
      if (rows.length === 0) return text("Nenhum lead com esse filtro.");
      return text(cap(rows.map((l) => `• [${l.id}] ${l.name} · ${SEGMENT_LABEL[l.segment] ?? l.segment}${l.city ? ` · ${l.city}` : ""} · ${stageLabel(l.stage)} · ${priorityLabel(l.priority)}${l.phone ? ` · ${l.phone}` : ""}${l.website ? ` · ${l.website}` : ""}\n    origem: ${l.source}${l.priorityReason ? `\n    por quê: ${l.priorityReason}` : ""}`).join("\n")));
    } catch (e) {
      return fail(e);
    }
  }) as never);

  add("registrar_lead", "Registra UMA empresa encontrada (dados da EMPRESA apenas: nada de pessoa física). Recusa duplicata (mesmo site, telefone ou nome+cidade), empresa fora do raio e excesso do limite por execução. A origem é obrigatória.", {
    nome: z.string().min(2).max(120), segmento: z.enum(LEAD_SEGMENTS), cidade: z.string().max(80).optional(), endereco: z.string().max(200).optional(),
    telefone: z.string().max(30).optional().describe("Telefone EMPRESARIAL público."), site: z.string().max(200).optional(), distancia_km: z.number().min(0).max(2000).optional().describe("Distância aproximada da cidade-base."),
    fonte: z.string().min(4).max(300).describe("URL ou nome da fonte onde a empresa foi encontrada."), necessidade: z.string().max(400).optional().describe("Necessidade tecnológica PROVÁVEL (hipótese, diga o sinal observado)."),
  }, (async (args: { nome: string; segmento: (typeof LEAD_SEGMENTS)[number]; cidade?: string; endereco?: string; telefone?: string; site?: string; distancia_km?: number; fonte: string; necessidade?: string }) => {
    try {
      const settings = await getCommercialSettings();
      if (args.distancia_km !== undefined && args.distancia_km > settings.radiusKm) return text(`Fora do raio configurado (${settings.radiusKm} km): ${args.nome} está a ~${args.distancia_km} km. Não registrada.`, true);
      const task = await prisma.agentTask.findUnique({ where: { id: taskId }, select: { createdAt: true } });
      const already = await prisma.lead.count({ where: { foundBy: agentName, createdAt: { gte: task?.createdAt ?? new Date(Date.now() - 6 * 3600_000) } } });
      if (already >= settings.maxNewLeadsPerRun) return text(`Limite de ${settings.maxNewLeadsPerRun} leads novos nesta execução atingido. Pare e entregue o relatório.`, true);
      const data = { name: clean(args.nome, 120)!, city: clean(args.cidade, 80), phone: clean(args.telefone, 30), website: clean(args.site, 200) };
      const keys = leadKeys(data);
      const dup = await prisma.lead.findFirst({ where: { OR: [{ keys: { hasSome: keys } }, { fingerprint: { in: keys } }] }, select: { id: true, name: true, stage: true } });
      if (dup) return text(`Duplicada: já existe "${dup.name}" (${dup.id}, ${stageLabel(dup.stage)}). Não registrei. Siga para a PRÓXIMA empresa — isso não é falha.`, true);
      const lead = await prisma.lead.create({
        data: { ...data, fingerprint: keys[0], keys, segment: args.segmento, address: clean(args.endereco, 200), distanceKm: args.distancia_km ?? null, source: clean(args.fonte, 300)!, foundBy: agentName, techNeed: clean(args.necessidade, 400) },
      });
      await prisma.leadInteraction.create({ data: { leadId: lead.id, kind: "NOTA", content: `Encontrada por ${agentName}. Fonte: ${lead.source}`, agentName } });
      const left = Math.max(0, settings.maxNewLeadsPerRun - already - 1);
      return text(`Registrada: ${lead.name} [${lead.id}]. Faltam ${left} para o limite desta execução${left > 0 ? " — continue pesquisando outras empresas, cidades e segmentos até atingi-lo ou esgotar as fontes" : ": pare e entregue o relatório"}.`);
    } catch (e) {
      return fail(e);
    }
  }) as never);

  add("qualificar_lead", "Classifica um lead NOVO ou EM_ANALISE: prioridade (ALTA/MEDIA/BAIXA) com justificativa OBRIGATÓRIA, produto que combina, dores prováveis, informações faltantes e uma opinião (não fato) sobre a conversão. Também descarta irrelevantes/duplicados com motivo.", {
    lead_id: z.string().min(5).max(40), prioridade: z.enum(LEAD_PRIORITIES).optional(), justificativa: z.string().min(20).max(800).optional(), produto: z.string().max(200).optional(), dores: z.string().max(500).optional(),
    faltantes: z.string().max(400).optional(), conversao: z.string().max(300).optional().describe("Opinião sobre a chance de conversão, marcada como estimativa."), descartar: z.boolean().optional(), motivo_descarte: z.string().max(300).optional(),
  }, (async (args: { lead_id: string; prioridade?: (typeof LEAD_PRIORITIES)[number]; justificativa?: string; produto?: string; dores?: string; faltantes?: string; conversao?: string; descartar?: boolean; motivo_descarte?: string }) => {
    try {
      const lead = await prisma.lead.findUnique({ where: { id: args.lead_id } });
      if (!lead) return text("Lead não encontrado.", true);
      if (!["NOVO", "EM_ANALISE"].includes(lead.stage)) return text(`Este lead já está em "${stageLabel(lead.stage)}": não requalifico.`, true);
      if (args.descartar) {
        if (!args.motivo_descarte) return text("Informe motivo_descarte.", true);
        await prisma.lead.update({ where: { id: lead.id }, data: { discarded: true, discardReason: clean(args.motivo_descarte, 300) } });
        await prisma.leadInteraction.create({ data: { leadId: lead.id, kind: "ETAPA", content: `Descartado: ${clean(args.motivo_descarte, 300)}`, agentName } });
        return text(`Descartado: ${lead.name}.`);
      }
      if (!args.prioridade || !args.justificativa) return text("Para qualificar informe prioridade e justificativa (obrigatórias).", true);
      await prisma.lead.update({
        where: { id: lead.id },
        data: { priority: args.prioridade, priorityReason: clean(args.justificativa, 800), productFit: clean(args.produto, 200), painPoints: clean(args.dores, 500), missingInfo: clean(args.faltantes, 400), conversionNote: args.conversao ? `Estimativa (opinião): ${clean(args.conversao, 300)}` : null, stage: "QUALIFICADO" },
      });
      await prisma.leadInteraction.create({ data: { leadId: lead.id, kind: "ETAPA", content: `Qualificado como ${priorityLabel(args.prioridade)}: ${clean(args.justificativa, 400)}`, agentName } });
      return text(`${lead.name}: ${priorityLabel(args.prioridade)} → Qualificado.`);
    } catch (e) {
      return fail(e);
    }
  }) as never);

  add("atualizar_lead", "Atualiza o cadastro e a etapa de um lead. Você NÃO decide Convertido nem Perdido (só o Italo), e só marca Primeiro contato/Em negociação se já existe um envio real registrado pelo Italo.", {
    lead_id: z.string().min(5).max(40), etapa: z.enum(LEAD_STAGE_IDS).optional(), telefone: z.string().max(30).optional(), site: z.string().max(200).optional(), cidade: z.string().max(80).optional(), endereco: z.string().max(200).optional(), observacao: z.string().max(600).optional(),
  }, (async (args: { lead_id: string; etapa?: string; telefone?: string; site?: string; cidade?: string; endereco?: string; observacao?: string }) => {
    try {
      const lead = await prisma.lead.findUnique({ where: { id: args.lead_id } });
      if (!lead) return text("Lead não encontrado.", true);
      if (args.etapa && args.etapa !== lead.stage) {
        if (HUMAN_ONLY_STAGES.includes(args.etapa)) return text(`"${stageLabel(args.etapa)}" só o Italo decide. Registre uma observação e sinalize no relatório.`, true);
        if (NEEDS_REAL_CONTACT.includes(args.etapa)) {
          const sent = await prisma.leadInteraction.count({ where: { leadId: lead.id, OR: [{ status: "ENVIADO" }, { kind: "CONTATO" }] } });
          if (sent === 0) return text(`Não há contato real registrado para ${lead.name}: não posso mover para "${stageLabel(args.etapa)}".`, true);
        }
      }
      const patch = { ...(args.etapa ? { stage: args.etapa } : {}), ...(args.telefone ? { phone: clean(args.telefone, 30) } : {}), ...(args.site ? { website: clean(args.site, 200) } : {}), ...(args.cidade ? { city: clean(args.cidade, 80) } : {}), ...(args.endereco ? { address: clean(args.endereco, 200) } : {}) };
      const keys = leadKeys({ name: lead.name, city: patch.city ?? lead.city, phone: patch.phone ?? lead.phone, website: patch.website ?? lead.website });
      await prisma.lead.update({ where: { id: lead.id }, data: { ...patch, keys: [...new Set([...lead.keys, ...keys])] } });
      if (args.etapa || args.observacao) await prisma.leadInteraction.create({ data: { leadId: lead.id, kind: args.etapa ? "ETAPA" : "NOTA", content: `${args.etapa && args.etapa !== lead.stage ? `Etapa ${stageLabel(lead.stage)} → ${stageLabel(args.etapa)}. ` : ""}${clean(args.observacao, 600) ?? ""}`.trim(), agentName } });
      return text(`${lead.name} atualizado.`);
    } catch (e) {
      return fail(e);
    }
  }) as never);

  add("registrar_interacao", "Anota uma observação no histórico do lead (somente NOTA: contatos reais são registrados pelo Italo ao marcar 'Enviei').", { lead_id: z.string().min(5).max(40), nota: z.string().min(3).max(800) }, (async (args: { lead_id: string; nota: string }) => {
    try {
      const lead = await prisma.lead.findUnique({ where: { id: args.lead_id }, select: { id: true, name: true } });
      if (!lead) return text("Lead não encontrado.", true);
      await prisma.leadInteraction.create({ data: { leadId: lead.id, kind: "NOTA", content: clean(args.nota, 800)!, agentName } });
      return text(`Nota registrada em ${lead.name}.`);
    } catch (e) {
      return fail(e);
    }
  }) as never);

  add("status_funil", "Funil REAL agora: leads por etapa e prioridade, abordagens pendentes de aprovação e leads parados (sem atualização há mais de 7 dias). Use antes de qualquer relatório; nunca invente números.", {}, (async () => {
    try {
      const now = new Date();
      const [byStage, byPriority, pending, openLeads, total, discarded] = await Promise.all([
        prisma.lead.groupBy({ by: ["stage"], where: { discarded: false }, _count: { _all: true } }),
        prisma.lead.groupBy({ by: ["priority"], where: { discarded: false }, _count: { _all: true } }),
        prisma.leadInteraction.count({ where: { status: "PENDENTE_APROVACAO" } }),
        prisma.lead.findMany({ where: { discarded: false, stage: { notIn: ["CONVERTIDO", "PERDIDO"] } }, orderBy: { updatedAt: "asc" }, take: 60 }),
        prisma.lead.count(),
        prisma.lead.count({ where: { discarded: true } }),
      ]);
      const stale = openLeads.filter((l) => isStale(l, now)).slice(0, 10);
      const converted = byStage.find((s) => s.stage === "CONVERTIDO")?._count._all ?? 0;
      const m = funnelMetrics({ total, discarded, qualified: 0, open: openLeads.length, pendingApproaches: pending, converted });
      return text(cap([
        `Funil: ${total - discarded} lead(s) ativo(s), ${discarded} descartado(s); conversão ${m.conversionRate === null ? "—" : `${m.conversionRate}%`}.`,
        `Por etapa: ${byStage.map((s) => `${stageLabel(s.stage)} ${s._count._all}`).join(" · ") || "vazio"}`,
        `Por prioridade: ${byPriority.map((p) => `${priorityLabel(p.priority)} ${p._count._all}`).join(" · ") || "—"}`,
        `Abordagens pendentes de aprovação: ${pending}`,
        stale.length ? `Parados há mais de 7 dias:\n${stale.map((l) => `• [${l.id}] ${l.name} (${stageLabel(l.stage)})`).join("\n")}` : "Nenhum lead parado.",
      ].join("\n")));
    } catch (e) {
      return fail(e);
    }
  }) as never);

  add("preparar_abordagem", "Prepara um RASCUNHO de mensagem (WhatsApp, e-mail…) para um lead QUALIFICADO. NADA é enviado: o rascunho fica pendente de aprovação do Italo. Texto personalizado, honesto, sem prometer o que o catálogo não tem e sem dado pessoal.", {
    lead_id: z.string().min(5).max(40), canal: z.enum(INTERACTION_CHANNELS), mensagem: z.string().min(20).max(1500), proposta: z.string().max(2000).optional().describe("Proposta comercial resumida, se couber."),
  }, (async (args: { lead_id: string; canal: (typeof INTERACTION_CHANNELS)[number]; mensagem: string; proposta?: string }) => {
    try {
      const lead = await prisma.lead.findUnique({ where: { id: args.lead_id } });
      if (!lead || lead.discarded) return text("Lead não encontrado ou descartado.", true);
      if (!["QUALIFICADO", "AGUARDANDO_ABORDAGEM"].includes(lead.stage)) return text(`Só preparo abordagem para lead qualificado (este está em "${stageLabel(lead.stage)}").`, true);
      const pending = await prisma.leadInteraction.count({ where: { leadId: lead.id, kind: "RASCUNHO", status: "PENDENTE_APROVACAO" } });
      if (pending > 0) return text(`${lead.name} já tem um rascunho aguardando o Italo. Não preparo outro.`, true);
      await prisma.leadInteraction.create({ data: { leadId: lead.id, kind: "RASCUNHO", channel: args.canal, content: `${clean(args.mensagem, 1500)}${args.proposta ? `\n\n— PROPOSTA —\n${clean(args.proposta, 2000)}` : ""}`, status: "PENDENTE_APROVACAO", agentName } });
      await prisma.lead.update({ where: { id: lead.id }, data: { stage: "AGUARDANDO_ABORDAGEM" } });
      void notify({ kind: "approval", level: "info", title: `Abordagem pendente: ${lead.name}`, body: `${agentName} preparou um rascunho (${args.canal}). Nada foi enviado: revise e decida.`, tag: `lead-approach:${lead.id}`, audience: { permission: "provider:read", requireGlobal: true } }).catch(() => undefined);
      return text(`Rascunho de ${args.canal} para ${lead.name} salvo, PENDENTE de aprovação humana (nada foi enviado).`);
    } catch (e) {
      return fail(e);
    }
  }) as never);

  return defs.map(([, t]) => t);
}
