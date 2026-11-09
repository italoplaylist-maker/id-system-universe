/** Uso do plano do Claude (conta logada no servidor) + tokens dos agentes. Funções puras, usadas no servidor e na tela do núcleo. */
export interface PlanWindow {
  /** 0–100, ou null se o Claude não informou. */
  percent: number | null;
  resetsAt: string | null;
}

export interface ClaudeUsageView {
  /** Plano (pro, max, team…) ou null quando a conta é por chave de API (sem limites de plano). */
  plan: string | null;
  planLimitsAvailable: boolean;
  fiveHour: PlanWindow | null;
  sevenDay: PlanWindow | null;
  /** Tokens gastos pelas execuções dos agentes (entrada + saída + cache). */
  tokens: { day: number; week: number; dayInput: number; dayOutput: number };
  error: string | null;
  at: string;
}

interface RawWindow {
  utilization: number | null;
  resets_at: string | null;
}
export interface RawPlanUsage {
  subscription_type: string | null;
  rate_limits_available: boolean;
  rate_limits: { five_hour?: RawWindow | null; seven_day?: RawWindow | null } | null;
}

const win = (w: RawWindow | null | undefined): PlanWindow | null =>
  w ? { percent: w.utilization === null ? null : Math.min(100, Math.max(0, Math.round(w.utilization))), resetsAt: w.resets_at } : null;

/** Transforma a resposta do Claude no formato que a tela usa. */
export function mapPlanUsage(raw: RawPlanUsage | null): Pick<ClaudeUsageView, "plan" | "planLimitsAvailable" | "fiveHour" | "sevenDay"> {
  if (!raw) return { plan: null, planLimitsAvailable: false, fiveHour: null, sevenDay: null };
  return {
    plan: raw.subscription_type,
    planLimitsAvailable: raw.rate_limits_available,
    fiveHour: win(raw.rate_limits?.five_hour),
    sevenDay: win(raw.rate_limits?.seven_day),
  };
}

/** 950 → "950"; 12 345 → "12,3 mil"; 1 234 567 → "1,2 mi". */
export function fmtTokens(n: number): string {
  const f = (v: number) => v.toFixed(1).replace(".", ",").replace(/,0$/, "");
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${f(n / 1000)} mil`;
  return `${f(n / 1_000_000)} mi`;
}

/** Tempo até o reset: "35 min", "2h10", "3d 4h"; "agora" se já passou ou não há data. */
export function fmtReset(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - now;
  if (Number.isNaN(ms)) return "—";
  if (ms <= 60_000) return "agora";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${String(min % 60).padStart(2, "0")}`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
