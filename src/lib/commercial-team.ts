/**
 * Equipe COMERCIAL & MARKETING — a segunda equipe de agentes do Universe (a primeira é a AGENTES CLT). Lógica PURA: definição dos
 * 4 funcionários, regras de segurança, etapas do funil, impressão digital de lead (anti-duplicata), indicadores e rotinas.
 * O servidor (src/server/orchestrator/commercial.ts) executa; o Claude só entra quando uma tarefa é de fato rodada pelo worker.
 *
 * Separação de poderes: os agentes comerciais NÃO têm Bash, edição de arquivos, Git, deploy nem merge. Só pesquisam na web
 * (fontes públicas), leem o catálogo de produtos e escrevem no funil (Lead). Nenhuma mensagem externa sai sem aprovação humana.
 */

export const COMMERCIAL_TEAM_ID = "COMERCIAL";
export const COMMERCIAL_LABEL = "COMERCIAL & MARKETING";

export type CommercialSlug = "id-garimpeiro" | "id-analista" | "id-crm" | "id-vendedor";

export interface CommercialAgentDef {
  slug: CommercialSlug;
  name: string;
  roleTitle: string;
  specialty: string;
  description: string;
  model: "opus" | "sonnet" | "haiku";
  effort: "low" | "medium" | "high";
  dailyTokenLimit: number;
  monthlyTokenLimit: number;
}

/** Etapas do funil, na ordem. As duas últimas encerram a oportunidade. */
export const LEAD_STAGES = [
  { id: "NOVO", label: "Novo lead", open: true },
  { id: "EM_ANALISE", label: "Em análise", open: true },
  { id: "QUALIFICADO", label: "Qualificado", open: true },
  { id: "AGUARDANDO_ABORDAGEM", label: "Aguardando abordagem", open: true },
  { id: "PRIMEIRO_CONTATO", label: "Primeiro contato realizado", open: true },
  { id: "EM_NEGOCIACAO", label: "Em negociação", open: true },
  { id: "CONVERTIDO", label: "Cliente convertido", open: false },
  { id: "PERDIDO", label: "Perdido", open: false },
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number]["id"];
export const LEAD_STAGE_IDS = LEAD_STAGES.map((s) => s.id) as [LeadStage, ...LeadStage[]];
export const stageLabel = (id: string): string => LEAD_STAGES.find((s) => s.id === id)?.label ?? id;

export const LEAD_PRIORITIES = ["ALTA", "MEDIA", "BAIXA"] as const;
export type LeadPriority = (typeof LEAD_PRIORITIES)[number];
export const priorityLabel = (p: string | null): string => (p === "ALTA" ? "Alta prioridade" : p === "MEDIA" ? "Média prioridade" : p === "BAIXA" ? "Baixa prioridade" : "Sem classificação");

export const LEAD_SEGMENTS = ["barbearia", "restaurante", "padaria", "transportadora", "locadora-de-equipamentos", "comercio", "sistema-personalizado", "outro"] as const;
export const SEGMENT_LABEL: Record<string, string> = {
  barbearia: "Barbearias",
  restaurante: "Restaurantes",
  padaria: "Padarias",
  transportadora: "Transportadoras",
  "locadora-de-equipamentos": "Locadoras de equipamentos",
  comercio: "Comércios em geral",
  "sistema-personalizado": "Empresas que podem demandar sistema personalizado",
  outro: "Outro",
};

export const INTERACTION_CHANNELS = ["WHATSAPP", "EMAIL", "TELEFONE", "PRESENCIAL", "OUTRO"] as const;
/** RASCUNHO nasce PENDENTE_APROVACAO e só o humano muda: nada é enviado pelo Universe. */
export const INTERACTION_KINDS = ["NOTA", "RASCUNHO", "CONTATO", "PROPOSTA", "ETAPA"] as const;

/** Configuração inicial da prospecção (editável no painel). */
export const DEFAULT_COMMERCIAL_SETTINGS = {
  baseCity: "Itatiaiuçu/MG",
  radiusKm: 50,
  segments: ["barbearia", "restaurante", "padaria", "transportadora", "locadora-de-equipamentos", "comercio"] as string[],
  maxNewLeadsPerRun: 10,
};
export const MAX_RADIUS_KM = 300;

/** Regras da equipe (entram no prompt de TODOS os agentes comerciais). */
export const COMMERCIAL_RULES = [
  "Você faz parte da equipe COMERCIAL & MARKETING da ID System. Seu trabalho é encontrar empresas, qualificá-las e preparar a venda dos SaaS da ID System. Você NÃO mexe em código, deploy, infraestrutura nem credenciais — isso é da equipe AGENTES CLT.",
  "NUNCA envie mensagem, e-mail, WhatsApp ou proposta a ninguém. Você só PREPARA rascunhos com a ferramenta preparar_abordagem; eles ficam pendentes e o Italo decide e envia. Não faça disparo em massa.",
  "Use somente fontes públicas e respeite os termos de uso de cada site. Colete apenas dados comerciais da EMPRESA (nome, endereço, telefone empresarial, site, segmento). Não colete nem registre dados pessoais de pessoas físicas (CPF, e-mail ou telefone pessoal, redes sociais pessoais, fotos).",
  "Nunca invente. Se uma fonte estiver fora do ar, não responder ou não trouxer o dado, diga isso e deixe o campo vazio. Toda oportunidade registrada precisa de origem (URL ou nome da fonte) e justificativa. Estimativa de conversão é opinião, nunca fato: deixe isso claro.",
  "Antes de registrar uma empresa, confira se ela já existe (listar_leads / registrar_lead recusam duplicata). Só ofereça produtos que existem de verdade: consulte consultar_produtos e não prometa funcionalidade que o catálogo não traz.",
  "Gerencie seus tokens como dinheiro da empresa: pesquise com objetivo, não repita buscas já feitas, pare quando atingir o limite de leads da execução e siga a nota de ORÇAMENTO DE TOKENS no início da execução. Sem loop: uma execução termina quando o trabalho pedido está feito.",
  "Responda de forma curta, com o que foi feito, os números reais e as pendências.",
];

/** Ferramentas do Claude que a equipe comercial pode usar sem aprovação: só pesquisa pública. */
export const COMMERCIAL_ALLOWED_TOOLS = ["WebSearch", "WebFetch"];

/**
 * Bloqueadas por regra fixa: nada de shell, edição, Git, deploy, merge ou delegação técnica. (As ferramentas do Universe de Git
 * nem são entregues a esta equipe; esta lista é a segunda trava.)
 */
export const COMMERCIAL_DISALLOWED_TOOLS = [
  "Bash",
  "Edit",
  "Write",
  "NotebookEdit",
  "Read",
  "Grep",
  "Glob",
  "mcp__universe__publish_changes",
  "mcp__universe__merge_pull_request",
  "mcp__universe__cleanup_workspace",
  "mcp__universe__git_status",
  "mcp__universe__delegar_tarefa",
  "mcp__universe__ler_logs",
  "mcp__universe__listar_erros",
];

/** Ferramentas comerciais do Universe por cargo (todas só leem/gravam o funil; nenhuma envia nada). */
export const COMMERCIAL_TOOLS_BY_SLUG: Record<CommercialSlug, string[]> = {
  "id-garimpeiro": ["configuracao_prospeccao", "consultar_produtos", "listar_leads", "registrar_lead"],
  "id-analista": ["consultar_produtos", "listar_leads", "qualificar_lead"],
  "id-crm": ["consultar_produtos", "listar_leads", "atualizar_lead", "registrar_interacao", "status_funil"],
  "id-vendedor": ["consultar_produtos", "listar_leads", "preparar_abordagem", "registrar_interacao"],
};
export const ALL_COMMERCIAL_TOOLS = [...new Set(Object.values(COMMERCIAL_TOOLS_BY_SLUG).flat())];
export const COMMERCIAL_MCP_TOOLS = ALL_COMMERCIAL_TOOLS.map((n) => `mcp__universe__${n}`);

export const COMMERCIAL_TEAM: CommercialAgentDef[] = [
  {
    slug: "id-garimpeiro",
    name: "Garimpeiro",
    roleTitle: "Prospecção de clientes",
    specialty: "Prospecção",
    description:
      "Você é o Garimpeiro: encontra empresas que podem comprar os SaaS da ID System. Responsabilidades: (1) leia a configuração com configuracao_prospeccao (cidade-base, raio em km, segmentos e limite de leads por execução) e respeite-a; (2) pesquise com WebSearch/WebFetch empresas dos segmentos configurados dentro do raio, usando fontes públicas; (3) priorize empresas com sinais de processo manual (sem site ou sem sistema de agendamento/pedido/estoque, controle em papel ou WhatsApp, cadastro desatualizado); (4) para cada empresa, registre com registrar_lead: nome, segmento, cidade, endereço, telefone empresarial, site, distância aproximada, a ORIGEM (URL ou fonte) e a necessidade tecnológica provável (rotulada como hipótese); (5) a ferramenta recusa duplicatas — não insista; (6) pare ao atingir o limite de leads novos da execução. Não classifique prioridade nem aborde ninguém: isso é do Analista e do Vendedor. Entregue: quantas empresas pesquisou, quantas registrou, quantas eram duplicadas e quais fontes falharam.",
    model: "sonnet",
    effort: "medium",
    dailyTokenLimit: 3_000_000,
    monthlyTokenLimit: 60_000_000,
  },
  {
    slug: "id-analista",
    name: "Analista Comercial",
    roleTitle: "Inteligência e qualificação de leads",
    specialty: "Análise comercial",
    description:
      "Você é o Analista Comercial: transforma a lista bruta em oportunidades priorizadas. Responsabilidades: (1) liste os leads NOVOS (listar_leads etapa=NOVO) e analise cada um, pesquisando só o necessário; (2) descubra qual produto do catálogo (consultar_produtos) combina com a empresa e que problema ele resolveria; (3) classifique com qualificar_lead: prioridade ALTA, MEDIA ou BAIXA, SEMPRE com a justificativa, mais dores prováveis, informações que faltam e uma estimativa qualitativa de conversão marcada como opinião; (4) descarte (descartar=true, com motivo) empresas irrelevantes, fechadas ou fora do perfil; (5) leads bons passam para QUALIFICADO. Não invente dados: o que não achou vai em 'informações faltantes'. Entregue: quantos analisou, quantos por prioridade, quantos descartados e por quê.",
    model: "sonnet",
    effort: "medium",
    dailyTokenLimit: 3_000_000,
    monthlyTokenLimit: 60_000_000,
  },
  {
    slug: "id-crm",
    name: "CRM",
    roleTitle: "Funil e acompanhamento comercial",
    specialty: "CRM",
    description:
      "Você é o CRM: mantém o funil organizado e nenhuma oportunidade esquecida. Responsabilidades: (1) use status_funil para ver o funil real (leads por etapa, parados sem acompanhamento, abordagens pendentes); (2) mova leads de etapa com atualizar_lead, seguindo o fluxo Novo lead → Em análise → Qualificado → Aguardando abordagem → Primeiro contato → Em negociação → Convertido/Perdido, e só registre 'Primeiro contato', 'Em negociação', 'Convertido' ou 'Perdido' quando houver uma interação REAL registrada pelo humano (nunca presuma); (3) registre observações e interações com registrar_interacao; (4) corrija cadastros incompletos e sinalize leads sem acompanhamento há mais de 7 dias, com próxima ação sugerida; (5) o CRM é o próprio funil do Universe (Lead): não crie planilhas nem estruturas paralelas. Entregue: o funil em números reais, o que moveu e o que está parado.",
    model: "haiku",
    effort: "low",
    dailyTokenLimit: 2_000_000,
    monthlyTokenLimit: 40_000_000,
  },
  {
    slug: "id-vendedor",
    name: "Vendedor",
    roleTitle: "Abordagem e propostas",
    specialty: "Vendas",
    description:
      "Você é o Vendedor: prepara a conversa que vira venda — mas quem envia é o Italo. Responsabilidades: (1) pegue leads QUALIFICADOS sem abordagem preparada (listar_leads etapa=QUALIFICADO); (2) consulte o catálogo (consultar_produtos) e use SÓ funcionalidades que existem; (3) para cada lead escreva, com preparar_abordagem, uma mensagem personalizada no canal certo (WhatsApp curto e direto; e-mail um pouco mais longo), adaptada ao segmento, com o benefício mais relevante e um próximo passo claro; quando fizer sentido, uma proposta resumida; (4) o texto é só RASCUNHO: fica pendente de aprovação humana e o lead vai para AGUARDANDO_ABORDAGEM; (5) nunca diga que enviou nada; (6) sem pressão, sem promessa que o produto não cumpre, sem dado pessoal. Entregue: quantos rascunhos preparou, para quais empresas e o que depende do Italo.",
    model: "sonnet",
    effort: "medium",
    dailyTokenLimit: 3_000_000,
    monthlyTokenLimit: 60_000_000,
  },
];

export const commercialDef = (slug: string): CommercialAgentDef | undefined => COMMERCIAL_TEAM.find((a) => a.slug === slug);

export function commercialRoleNote(def: { name: string; roleTitle: string; description: string }): string {
  return ` Você faz parte da equipe ${COMMERCIAL_LABEL} da ID System como ${def.roleTitle} (${def.name}). ${def.description} Regras da equipe: ${COMMERCIAL_RULES.join(" ")}`;
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const digits = (t: string) => t.replace(/\D+/g, "");

/** Domínio sem www (null se não for um endereço válido). */
export function siteDomain(site: string | null | undefined): string | null {
  if (!site) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

/**
 * Chaves de identidade de uma empresa, da mais forte para a mais fraca: site (domínio), telefone (últimos 10 dígitos),
 * nome+cidade. Duas empresas são a mesma se QUALQUER chave coincidir.
 */
export function leadKeys(l: { name: string; city?: string | null; phone?: string | null; website?: string | null }): string[] {
  const keys: string[] = [];
  const domain = siteDomain(l.website);
  if (domain && !/(facebook|instagram|linktr\.ee|wa\.me|whatsapp|google|ifood|tripadvisor)\./.test(domain)) keys.push(`site:${domain}`);
  const phone = digits(l.phone ?? "");
  if (phone.length >= 10) keys.push(`tel:${phone.slice(-10)}`);
  keys.push(`nome:${norm(l.name)}|${norm(l.city ?? "")}`);
  return keys;
}

/** Impressão digital gravada no banco (única): a chave mais forte disponível. */
export const leadFingerprint = (l: Parameters<typeof leadKeys>[0]): string => leadKeys(l)[0];

// ---------------------------------------------------------------------------
// Indicadores
// ---------------------------------------------------------------------------

export interface FunnelCounts {
  total: number;
  discarded: number;
  qualified: number;
  open: number;
  pendingApproaches: number;
  converted: number;
}

export interface FunnelMetrics extends FunnelCounts {
  /** Convertidos ÷ leads aproveitáveis (total − descartados). null se ainda não há lead. */
  conversionRate: number | null;
}

export function funnelMetrics(c: FunnelCounts): FunnelMetrics {
  const usable = c.total - c.discarded;
  return { ...c, conversionRate: usable > 0 ? Math.round((c.converted / usable) * 1000) / 10 : null };
}

/** Custo estimado em dinheiro só existe se o preço por milhão de tokens foi configurado; senão devolve null (nada de chute). */
export function operatingCost(tokens: number, costPerMillion: number | null): number | null {
  return costPerMillion === null || costPerMillion < 0 ? null : Math.round((tokens / 1_000_000) * costPerMillion * 100) / 100;
}

/** Leads parados: aberto, sem contato/atualização há mais de `days` dias. */
export function isStale(l: { stage: string; updatedAt: Date; lastContactAt: Date | null }, now: Date, days = 7): boolean {
  const open = LEAD_STAGES.find((s) => s.id === l.stage)?.open ?? false;
  if (!open) return false;
  const last = Math.max(l.updatedAt.getTime(), l.lastContactAt?.getTime() ?? 0);
  return now.getTime() - last > days * 24 * 3600_000;
}

// ---------------------------------------------------------------------------
// Rotinas padrão e ciclo coordenado
// ---------------------------------------------------------------------------

export interface CommercialRoutineDef {
  slug: CommercialSlug;
  name: string;
  prompt: string;
  days: number[];
  time: string;
  priority: number;
  gate: string;
  enabled: boolean;
}

const ECON = " Seja econômico e termine quando o trabalho pedido estiver feito; se não houver nada a fazer, responda em uma linha.";
const WEEKDAYS = [1, 2, 3, 4, 5];

/** Nascem DESLIGADAS: o Italo liga quando aprovar a configuração (região, segmentos, frequência). Os gatilhos evitam gastar token sem trabalho. */
export const COMMERCIAL_ROUTINES: CommercialRoutineDef[] = [
  { slug: "id-garimpeiro", name: "Prospecção de empresas", days: [1, 3, 5], time: "09:00", priority: 0, gate: "always", enabled: false, prompt: "Rotina de prospecção. Leia configuracao_prospeccao e registre novas empresas dos segmentos e do raio configurados, até o limite de leads novos por execução. Não repita empresas já cadastradas." + ECON },
  { slug: "id-analista", name: "Qualificação de leads novos", days: WEEKDAYS, time: "10:30", priority: 0, gate: "leads_novos", enabled: false, prompt: "Rotina de qualificação. Analise os leads com etapa NOVO: produto ideal, prioridade com justificativa, dores, informações faltantes; descarte os irrelevantes." + ECON },
  { slug: "id-crm", name: "Revisão do funil", days: WEEKDAYS, time: "11:30", priority: -1, gate: "leads_abertos", enabled: false, prompt: "Rotina de funil. Use status_funil, organize as etapas, corrija cadastros incompletos e sinalize leads parados há mais de 7 dias com a próxima ação sugerida." + ECON },
  { slug: "id-vendedor", name: "Preparação de abordagens", days: WEEKDAYS, time: "14:00", priority: 0, gate: "leads_qualificados", enabled: false, prompt: "Rotina de vendas. Para cada lead QUALIFICADO sem abordagem pendente, prepare um rascunho personalizado (preparar_abordagem). NÃO envie nada: os rascunhos aguardam aprovação do Italo." + ECON },
];

/** Passos do ciclo coordenado "Executar ciclo agora": cada um só começa quando o anterior termina. */
export const CYCLE_STEPS: Array<{ slug: CommercialSlug; label: string; prompt: string }> = [
  { slug: "id-garimpeiro", label: "Prospecção", prompt: "Ciclo comercial, passo 1/4 (prospecção): leia configuracao_prospeccao e registre novas empresas, até o limite de leads novos. Não repita cadastradas." + ECON },
  { slug: "id-analista", label: "Qualificação", prompt: "Ciclo comercial, passo 2/4 (qualificação): analise os leads NOVO, classifique com justificativa e descarte os irrelevantes." + ECON },
  { slug: "id-crm", label: "Funil", prompt: "Ciclo comercial, passo 3/4 (funil): use status_funil, organize as etapas e sinalize o que está parado." + ECON },
  { slug: "id-vendedor", label: "Abordagens", prompt: "Ciclo comercial, passo 4/4 (vendas): prepare rascunhos de abordagem para os QUALIFICADOS sem rascunho pendente. NÃO envie nada." + ECON },
];

/** Chave idempotente de um passo do ciclo: `cycle:<id>:<n>`. */
export const cycleKey = (cycleId: string, step: number) => `cycle:${cycleId}:${step}`;
export function parseCycleKey(key: string | null | undefined): { cycleId: string; step: number } | null {
  const m = /^cycle:([A-Za-z0-9_-]+):(\d+)$/.exec(key ?? "");
  return m ? { cycleId: m[1], step: Number(m[2]) } : null;
}
/** Próximo passo após terminar `step` (0-based) — null no último. Se o passo falhou o ciclo PARA (sem loop, sem insistir). */
export function nextCycleStep(step: number, status: "COMPLETED" | "FAILED" | "CANCELLED" | "INTERRUPTED"): number | null {
  if (status !== "COMPLETED") return null;
  return step + 1 < CYCLE_STEPS.length ? step + 1 : null;
}
