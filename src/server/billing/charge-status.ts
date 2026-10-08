import { diffDays, type CivilDate } from "@/lib/civil-date";

export type ChargeDisplayStatus = "PENDENTE" | "AGENDADA" | "VENCE_HOJE" | "VENCIDA" | "PAGA" | "CANCELADA";

/** Próximos N dias contam como "PENDENTE" (iminente); além disso a cobrança é só "AGENDADA". */
export const UPCOMING_WINDOW_DAYS = 7;

/**
 * O status exibido é DERIVADO da data — só PAGA/CANCELADA são gravados.
 * Assim "vencida" nunca fica defasada por um job que não rodou.
 */
export function deriveChargeStatus(charge: { status: "PENDING" | "PAID" | "CANCELLED"; dueDate: CivilDate }, today: CivilDate): ChargeDisplayStatus {
  if (charge.status === "PAID") return "PAGA";
  if (charge.status === "CANCELLED") return "CANCELADA";
  const days = diffDays(charge.dueDate, today);
  if (days < 0) return "VENCIDA";
  if (days === 0) return "VENCE_HOJE";
  return days <= UPCOMING_WINDOW_DAYS ? "PENDENTE" : "AGENDADA";
}

/** Dias de atraso — derivado, nunca persistido. */
export function daysOverdue(dueDate: CivilDate, today: CivilDate): number {
  return Math.max(0, diffDays(today, dueDate));
}
