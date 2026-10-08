/**
 * Datas "civis" (AAAA-MM-DD) sem fuso. Vencimento é um DIA, não um instante —
 * guardar/trafegar como string civil impede o clássico "dia 10 virou dia 9".
 * Instantes (envio de avisos) são calculados a partir de data civil + hora + fuso.
 */
export type CivilDate = string;

const CIVIL = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCivilDate(value: string): value is CivilDate {
  const m = CIVIL.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(mo) - 1 && date.getUTCDate() === Number(d);
}

export function civilToDate(civil: CivilDate): Date {
  const m = CIVIL.exec(civil);
  if (!m) throw new Error(`Data civil inválida: ${civil}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** Prisma `@db.Date` volta como Date em 00:00 UTC — lê sempre pelos getters UTC. */
export function dateToCivil(date: Date): CivilDate {
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function addDays(civil: CivilDate, days: number): CivilDate {
  const date = civilToDate(civil);
  date.setUTCDate(date.getUTCDate() + days);
  return dateToCivil(date);
}

/** Diferença (a - b) em dias corridos. */
export function diffDays(a: CivilDate, b: CivilDate): number {
  return Math.round((civilToDate(a).getTime() - civilToDate(b).getTime()) / 86_400_000);
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Soma meses preservando um dia-alvo (ajustado ao último dia do mês quando necessário). */
export function addMonthsWithDay(civil: CivilDate, months: number, day: number): CivilDate {
  const base = civilToDate(civil);
  const total = base.getUTCFullYear() * 12 + base.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month1 = (total % 12) + 1;
  return dateToCivil(new Date(Date.UTC(year, month1 - 1, Math.min(day, daysInMonth(year, month1)))));
}

export function formatCivilBR(civil: CivilDate): string {
  const [y, m, d] = civil.split("-");
  return `${d}/${m}/${y}`;
}

const MONTHS_PT = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];

/** "2026-11" → "NOVEMBRO/2026"; outros formatos de competência voltam como estão. */
export function formatCompetence(competence: string | null | undefined): string {
  if (!competence) return "";
  const m = /^(\d{4})-(\d{2})$/.exec(competence);
  if (m) return `${MONTHS_PT[Number(m[2]) - 1]}/${m[1]}`;
  if (isCivilDate(competence)) return formatCivilBR(competence);
  return competence;
}

/** Dia civil "hoje" no fuso informado. */
export function todayInTimezone(timezone: string, now: Date = new Date()): CivilDate {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parts as CivilDate;
}

/** Hora do dia (minutos desde 00:00) no fuso informado. */
export function minutesOfDayInTimezone(timezone: string, now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function offsetMinutes(timezone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

export function parseHHmm(value: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Instante (UTC) em que ocorre `civil` às `hhmm` no fuso `timezone`. */
export function zonedTimeToUtc(civil: CivilDate, hhmm: string, timezone: string): Date {
  const minutes = parseHHmm(hhmm) ?? 9 * 60;
  const base = civilToDate(civil).getTime() + minutes * 60_000;
  const first = new Date(base - offsetMinutes(timezone, new Date(base)) * 60_000);
  // Segunda passada resolve horários próximos a mudança de horário de verão.
  return new Date(base - offsetMinutes(timezone, first) * 60_000);
}
