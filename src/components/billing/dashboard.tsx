"use client";

import { Card } from "@/components/ui/card";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/cn";
import type { BillingSummary } from "@/server/billing/charge-service";

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "error" | "ok" | "warn" | "info" }) {
  return (
    <Card className="p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted">{label}</p>
      <p className={cn("mt-2 text-xl font-semibold tabular-nums", tone === "error" && "text-status-error", tone === "ok" && "text-status-running", tone === "warn" && "text-status-warning", tone === "info" && "text-status-deploying")}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </Card>
  );
}

export function BillingDashboard({ summary }: { summary: BillingSummary }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
      <Stat label="A receber" value={formatBRL(summary.toReceiveCents)} sub={`${summary.pendingCount} cobrança(s) pendente(s)`} />
      <Stat label="Recebido" value={formatBRL(summary.receivedCents)} sub="no mês / no período filtrado" tone="ok" />
      <Stat label="Vencido" value={formatBRL(summary.overdueCents)} sub={`${summary.overdueCount} cobrança(s)`} tone={summary.overdueCount > 0 ? "error" : undefined} />
      <Stat label="Vence hoje" value={formatBRL(summary.dueTodayCents)} sub={`${summary.dueTodayCount} cobrança(s)`} tone={summary.dueTodayCount > 0 ? "info" : undefined} />
      <Stat label="Próximos 7 dias" value={formatBRL(summary.next7DaysCents)} sub={`${summary.next7DaysCount} cobrança(s)`} tone={summary.next7DaysCount > 0 ? "warn" : undefined} />
      <Stat label="Recorrentes" value={String(summary.recurrences.activeCount)} sub={`≈ ${formatBRL(summary.recurrences.monthlyEquivalentCents)} / mês`} />
    </div>
  );
}
