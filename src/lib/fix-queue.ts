/** Fila de correção do ID Manager — lógica PURA: estado de cada erro e o pedido que o Manager recebe. */

export type FixState = "pending" | "fixing" | "sent" | "dismissed";

export interface FixItemInput {
  lastSeenAt: Date;
  fixSentAt: Date | null;
  dismissedAt: Date | null;
  /** A tarefa enviada ao Manager ainda está na fila ou rodando. */
  taskActive: boolean;
}

/**
 * pending = ninguém cuidou (ou o erro VOLTOU depois de enviado/descartado); fixing = o Manager está nisso;
 * sent = enviado e a tarefa terminou, sem o erro reaparecer; dismissed = descartado por um humano, sem reaparecer.
 */
export function fixState(i: FixItemInput): FixState {
  if (i.taskActive) return "fixing";
  const handled = Math.max(i.fixSentAt?.getTime() ?? 0, i.dismissedAt?.getTime() ?? 0);
  if (handled === 0 || i.lastSeenAt.getTime() > handled) return "pending";
  return (i.dismissedAt?.getTime() ?? 0) >= (i.fixSentAt?.getTime() ?? 0) ? "dismissed" : "sent";
}

export const FIX_KEY_PREFIX = "fix:";
export const fixIdempotencyKey = (groupId: string, at: Date) => `${FIX_KEY_PREFIX}${groupId}:${at.getTime()}`;

export const FINDING_CATEGORIES = ["seguranca", "desempenho", "qualidade", "divida-tecnica", "documentacao", "infraestrutura", "banco-de-dados", "outro", "acao-humana"] as const;
/** Categoria de achado que só o Italo resolve (credencial, painel de terceiro, autorização): vai para "Precisa de você", não para o Manager. */
export const HUMAN_CATEGORY = "acao-humana";

/** Ordem de prioridade do que espera o Italo: merge primeiro, depois autorizações, incidentes que escalaram e ações manuais. */
export type HumanActionKind = "merge" | "aprovacao" | "incidente" | "acao";
export const HUMAN_ACTION_PRIORITY: Record<HumanActionKind, number> = { merge: 1, aprovacao: 2, incidente: 3, acao: 4 };
export const HUMAN_ACTION_LABEL: Record<HumanActionKind, string> = { merge: "Merge pendente", aprovacao: "Autorizar", incidente: "Deploy falho — precisa de você", acao: "Ação sua" };

export function sortHumanActions<T extends { kind: HumanActionKind; at: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => HUMAN_ACTION_PRIORITY[a.kind] - HUMAN_ACTION_PRIORITY[b.kind] || a.at.localeCompare(b.at));
}
export const FINDING_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

/** Mesmo achado (sistema + título, sem caixa/acento/pontuação) = mesma impressão digital. */
export function findingKey(system: string | null, title: string): string {
  const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  return `${norm(system ?? "geral")}|${norm(title)}`;
}

/** Id do item na fila: "erro:<id>" (log) ou "achado:<id>" (registrado por agente). */
export function parseItemId(id: string): { kind: "erro" | "achado"; rawId: string } | null {
  const m = /^(erro|achado):(.+)$/.exec(id);
  return m ? { kind: m[1] as "erro" | "achado", rawId: m[2] } : null;
}

export function buildFindingBrief(f: { title: string; detail: string; severity: string; category: string; application: string | null; reportedBy: string }): string {
  return [
    `CORREÇÃO PEDIDA PELO ITALO — achado registrado pelo ${f.reportedBy}.`,
    `Título: ${f.title}`,
    `Sistema: ${f.application ?? "geral"} · categoria: ${f.category} · gravidade: ${f.severity}.`,
    `Detalhe:`,
    f.detail.slice(0, 3000),
    ``,
    `Você gerencia esta melhoria, UM item por vez. Confirme o achado no código/ambiente antes de agir, delegue (delegar_tarefa) ao especialista certo (Doctor, Guardian, Optimizer, QA, DevOps ou Architect) e acompanhe com resultado_delegacoes. Entregue um resumo curto: o que era, o que foi feito e o que falta. Mudança de código vai em PR para revisão do Italo — não faça merge (merge só é permitido em incidente de deploy falho).`,
  ].join("\n");
}

export function buildFixBrief(e: { application: string; project: string | null; count: number; firstSeenAt: string; lastSeenAt: string; sample: string }): string {
  return [
    `CORREÇÃO PEDIDA PELO ITALO — erro de sistema encontrado pela equipe CLT.`,
    `Sistema: ${e.project ? `${e.project} / ` : ""}${e.application}. Ocorrências: ${e.count}× (primeira ${e.firstSeenAt}, última ${e.lastSeenAt}).`,
    `Trecho do log (segredos já mascarados):`,
    e.sample.slice(0, 3000),
    ``,
    `Você gerencia esta correção, UM erro por vez. Use ler_logs para o contexto, delegue (delegar_tarefa) ao ID Doctor (erro de código) ou ao ID DevOps (ambiente/servidor), acompanhe com resultado_delegacoes e entregue um resumo curto: causa, o que foi feito e o que falta. Correção de código vai em PR para revisão do Italo — não faça merge (merge só é permitido em incidente de deploy falho).`,
  ].join("\n");
}
