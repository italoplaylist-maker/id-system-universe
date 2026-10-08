"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Pause, Play, Square } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ApiClientError } from "@/lib/api-client";
import { formatBRL } from "@/lib/money";
import { formatCivilBR } from "@/lib/civil-date";
import { RECURRENCE_PERIOD_LABEL } from "@/lib/billing-defaults";
import { useRecurrenceStatus, useRecurrences } from "@/hooks/use-billing";
import type { RecurrenceListItem } from "@/server/billing/recurrence-service";

const STATUS_LABEL = { ACTIVE: "Ativa", PAUSED: "Pausada", ENDED: "Encerrada" } as const;

export function RecurrencesPanel({ canManage }: { canManage: boolean }) {
  const { data, isLoading } = useRecurrences();
  const mutate = useRecurrenceStatus();
  const [ending, setEnding] = useState<RecurrenceListItem | null>(null);

  async function run(id: string, action: "PAUSE" | "RESUME" | "END", ok: string) {
    try {
      await mutate.mutateAsync({ id, action });
      toast.success(ok);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Não foi possível concluir.");
    }
  }

  if (isLoading) return <p className="text-sm text-muted">Carregando…</p>;
  if (!data || data.length === 0) return <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted">Nenhuma recorrência cadastrada. Crie uma em “Nova cobrança” marcando “Cobrança recorrente”.</p>;

  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-border text-[11px] uppercase tracking-wider text-muted">
          <tr>
            <th className="px-4 py-2 font-medium">Cliente</th>
            <th className="px-4 py-2 font-medium">Motivo</th>
            <th className="px-4 py-2 text-right font-medium">Valor</th>
            <th className="px-4 py-2 font-medium">Periodicidade</th>
            <th className="px-4 py-2 font-medium">Início</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Cobranças</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-2.5 font-medium">{r.clientName}</td>
              <td className="max-w-[200px] truncate px-4 py-2.5 text-muted">{r.description}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{formatBRL(r.amountCents)}</td>
              <td className="px-4 py-2.5">
                {RECURRENCE_PERIOD_LABEL[r.period as keyof typeof RECURRENCE_PERIOD_LABEL] ?? r.period}
                {r.dueDay ? ` · dia ${r.dueDay}` : ""}
              </td>
              <td className="px-4 py-2.5 tabular-nums">{formatCivilBR(r.startDate)}</td>
              <td className="px-4 py-2.5">{STATUS_LABEL[r.status]}</td>
              <td className="px-4 py-2.5 tabular-nums">{r.chargeCount}</td>
              <td className="px-4 py-2.5 text-right">
                {canManage && r.status === "ACTIVE" && (
                  <Button variant="ghost" size="sm" onClick={() => run(r.id, "PAUSE", "Recorrência pausada.")}>
                    <Pause className="h-3.5 w-3.5" /> Pausar
                  </Button>
                )}
                {canManage && r.status === "PAUSED" && (
                  <Button variant="ghost" size="sm" onClick={() => run(r.id, "RESUME", "Recorrência retomada.")}>
                    <Play className="h-3.5 w-3.5" /> Retomar
                  </Button>
                )}
                {canManage && r.status !== "ENDED" && (
                  <Button variant="ghost" size="sm" onClick={() => setEnding(r)}>
                    <Square className="h-3.5 w-3.5" /> Encerrar
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ConfirmDialog
        open={ending !== null}
        onOpenChange={(open) => !open && setEnding(null)}
        title="Encerrar esta recorrência?"
        description="Novas cobranças não serão mais geradas. As cobranças já criadas e o histórico permanecem."
        confirmLabel="Encerrar recorrência"
        danger
        onConfirm={() => (ending ? run(ending.id, "END", "Recorrência encerrada.") : undefined)}
      />
    </Card>
  );
}
