/**
 * Painel da equipe AGENTES CLT e delegação do ID Manager — lógica PURA (sem banco): janelas de dias no fuso da empresa,
 * escalas de gráfico e as regras de segurança da delegação.
 */
import { localParts } from "./clt-routines";

export const DASHBOARD_DAYS = 14;

/** Dia ("AAAA-MM-DD") no fuso de São Paulo. */
export const dayKey = (d: Date): string => localParts(d).date;

/** Os últimos `n` dias terminando hoje, em ordem crescente (São Paulo não tem horário de verão: 24 h por dia). */
export function lastDays(n: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) out.push(dayKey(new Date(now.getTime() - i * 24 * 3600_000)));
  return out;
}

/** Soma `value` de cada linha no dia dela; linhas fora da janela ou sem data são ignoradas. */
export function bucketByDay(rows: Array<{ at: Date | null; value: number }>, days: string[]): number[] {
  const index = new Map(days.map((d, i) => [d, i]));
  const out = days.map(() => 0);
  for (const r of rows) {
    if (!r.at) continue;
    const i = index.get(dayKey(r.at));
    if (i !== undefined) out[i] += r.value;
  }
  return out;
}

/** "2026-11-10" → "10/11". */
export const dayLabel = (key: string): string => `${key.slice(8, 10)}/${key.slice(5, 7)}`;

/** Próximo valor "redondo" (1, 2, 5 × 10^k) que cobre `max`: o topo limpo do eixo. */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const exp = Math.floor(Math.log10(max));
  const base = 10 ** exp;
  for (const m of [1, 2, 5, 10]) if (m * base >= max) return m * base;
  return 10 * base;
}

/** Marcas do eixo Y de 0 até o topo limpo (`count` + 1 marcas). */
export function axisTicks(max: number, count = 4): number[] {
  const top = niceMax(max);
  return Array.from({ length: count + 1 }, (_, i) => (top * i) / count);
}

// ---------------------------------------------------------------------------
// Delegação do ID Manager
// ---------------------------------------------------------------------------

/** Teto de tarefas que o Manager pode delegar numa mesma execução e por dia (trava contra gasto descontrolado). */
export const MAX_DELEGATIONS_PER_RUN = 5;
export const MAX_DELEGATIONS_PER_DAY = 30;

export const DELEGATION_PRIORITIES = { alta: 1, normal: 0, baixa: -1 } as const;
export type DelegationPriority = keyof typeof DELEGATION_PRIORITIES;

export interface DelegationInput {
  /** Slug de quem delega e do destino. */
  selfSlug: string;
  target: { slug: string; paused: boolean; archived: boolean };
  /** Já existe tarefa igual na fila/em execução na equipe? */
  duplicateOpen: boolean;
  delegatedThisRun: number;
  delegatedToday: number;
  /** Motivo do bloqueio de orçamento do destino (null = tem orçamento). */
  budgetReason: string | null;
}

export type DelegationCheck = { ok: true } | { ok: false; reason: string };

/** Ordem importa: a primeira regra violada é o motivo devolvido ao Manager. */
export function checkDelegation(i: DelegationInput): DelegationCheck {
  if (i.target.slug === i.selfSlug) return { ok: false, reason: "O ID Manager não delega para si mesmo: execute o trabalho de coordenação direto." };
  if (i.target.archived) return { ok: false, reason: "Esse agente foi removido." };
  if (i.target.paused) return { ok: false, reason: "Esse agente está pausado; escolha outro ou peça ao Italo para retomá-lo." };
  if (i.delegatedThisRun >= MAX_DELEGATIONS_PER_RUN) return { ok: false, reason: `Limite de ${MAX_DELEGATIONS_PER_RUN} delegações por execução atingido. Priorize e delegue o resto na próxima rodada.` };
  if (i.delegatedToday >= MAX_DELEGATIONS_PER_DAY) return { ok: false, reason: `Limite de ${MAX_DELEGATIONS_PER_DAY} delegações por dia atingido.` };
  if (i.duplicateOpen) return { ok: false, reason: "Já existe uma tarefa igual na fila ou em execução na equipe. Não duplique: acompanhe o resultado dela." };
  if (i.budgetReason) return { ok: false, reason: `Sem orçamento de tokens: ${i.budgetReason}` };
  return { ok: true };
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Acha o agente por slug, nome ("ID Doctor") ou parte do nome ("doctor"). Ambíguo devolve as opções. */
export function resolveAgentRef(ref: string, agents: Array<{ id: string; name: string; slug: string }>): { id: string; name: string; slug: string } | { ambiguous: string[] } | null {
  const r = norm(ref);
  if (!r) return null;
  const exact = agents.filter((a) => norm(a.slug) === r || norm(a.name) === r);
  if (exact.length === 1) return exact[0];
  const partial = agents.filter((a) => norm(a.name).includes(r) || norm(a.slug).includes(r));
  if (partial.length === 1) return partial[0];
  return partial.length > 1 ? { ambiguous: partial.map((a) => a.name) } : null;
}
