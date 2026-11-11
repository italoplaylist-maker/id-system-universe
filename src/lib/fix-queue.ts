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
