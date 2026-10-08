"use client";

import { formatBRL } from "@/lib/money";
import { formatCivilBR } from "@/lib/civil-date";
import { Card } from "@/components/ui/card";
import { ChargeStatusPill, formatDateTimeBR } from "@/components/billing/status";
import type { ChargeListItem } from "@/server/billing/charge-service";

export function ChargesTable({ items, onOpen, emptyText = "Nenhuma cobrança encontrada." }: { items: ChargeListItem[]; onOpen: (id: string) => void; emptyText?: string }) {
  if (items.length === 0) return <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted">{emptyText}</p>;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-left text-sm">
        <thead className="border-b border-border text-[11px] uppercase tracking-wider text-muted">
          <tr>
            <th className="px-4 py-2 font-medium">Cliente</th>
            <th className="px-4 py-2 font-medium">Motivo</th>
            <th className="px-4 py-2 font-medium">Projeto</th>
            <th className="px-4 py-2 text-right font-medium">Valor</th>
            <th className="px-4 py-2 font-medium">Vencimento</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Recorrência</th>
            <th className="px-4 py-2 font-medium">Último aviso</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((item) => (
            <tr key={item.id} className="cursor-pointer hover:bg-surface-raised" onClick={() => onOpen(item.id)}>
              <td className="px-4 py-2.5 font-medium">{item.clientName}</td>
              <td className="max-w-[220px] truncate px-4 py-2.5 text-muted">{item.description}</td>
              <td className="px-4 py-2.5 text-muted">{item.projectName ?? "—"}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{formatBRL(item.amountCents)}</td>
              <td className="px-4 py-2.5 tabular-nums">{formatCivilBR(item.dueDate)}</td>
              <td className="px-4 py-2.5">
                <ChargeStatusPill status={item.status} daysOverdue={item.daysOverdue} />
              </td>
              <td className="px-4 py-2.5 text-muted">{item.recurrenceId ? "Sim" : "—"}</td>
              <td className="px-4 py-2.5 text-xs text-muted">{item.lastReminderAt ? formatDateTimeBR(item.lastReminderAt) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
