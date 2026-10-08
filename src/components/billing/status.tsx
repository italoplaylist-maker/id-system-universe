import { cn } from "@/lib/cn";
import type { ChargeDisplayStatus } from "@/server/billing/charge-status";

export const CHARGE_STATUS_LABEL: Record<ChargeDisplayStatus, string> = {
  PENDENTE: "Pendente",
  AGENDADA: "Agendada",
  VENCE_HOJE: "Vence hoje",
  VENCIDA: "Vencida",
  PAGA: "Paga",
  CANCELADA: "Cancelada",
};

const CLASSES: Record<ChargeDisplayStatus, string> = {
  PENDENTE: "border-status-warning/40 bg-status-warning/10 text-status-warning",
  AGENDADA: "border-border bg-surface-raised text-muted",
  VENCE_HOJE: "border-status-deploying/40 bg-status-deploying/10 text-status-deploying",
  VENCIDA: "border-status-error/40 bg-status-error/10 text-status-error",
  PAGA: "border-status-running/40 bg-status-running/10 text-status-running",
  CANCELADA: "border-border bg-surface text-muted line-through",
};

export function ChargeStatusPill({ status, daysOverdue }: { status: ChargeDisplayStatus; daysOverdue?: number }) {
  return (
    <span className={cn("inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium", CLASSES[status])}>
      {status === "VENCIDA" && daysOverdue ? `${daysOverdue} ${daysOverdue === 1 ? "dia" : "dias"} em atraso` : CHARGE_STATUS_LABEL[status]}
    </span>
  );
}

export function formatDateTimeBR(iso: string | null | undefined, timezone = "America/Sao_Paulo"): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
