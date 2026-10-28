export type AlertLevel = "ok" | "warning" | "critical";

/** Limiares de alerta — um só lugar, usados pela API, pelo scheduler e pela UI (via status derivado). */
export const THRESHOLDS = {
  cpu: { warning: 80, critical: 90 },
  mem: { warning: 85, critical: 92 },
  disk: { warning: 80, critical: 90 },
} as const;

/** Sem sinal por mais que isto = OFFLINE (o agente envia a cada ~15 s). */
export const OFFLINE_AFTER_MS = 90_000;

export function levelFor(kind: keyof typeof THRESHOLDS, percent: number): AlertLevel {
  const t = THRESHOLDS[kind];
  if (percent >= t.critical) return "critical";
  if (percent >= t.warning) return "warning";
  return "ok";
}

export type ServerStatus = "WAITING" | "ONLINE" | "OFFLINE";

/** Derivado do último sinal — nunca gravado, então nunca fica defasado. */
export function serverStatus(lastSeenAt: Date | null, now: Date = new Date()): ServerStatus {
  if (!lastSeenAt) return "WAITING";
  return now.getTime() - lastSeenAt.getTime() > OFFLINE_AFTER_MS ? "OFFLINE" : "ONLINE";
}

export function percentOf(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
}
