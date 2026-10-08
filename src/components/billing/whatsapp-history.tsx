"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { formatDateTimeBR } from "@/components/billing/status";
import { useWhatsAppHistory } from "@/hooks/use-billing";

export function WhatsAppHistory() {
  const [status, setStatus] = useState("");
  const { data, isLoading } = useWhatsAppHistory(status || undefined);
  return (
    <div className="space-y-3">
      <Select className="max-w-[200px]" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">Todos os status</option>
        <option value="SENT">Enviadas</option>
        <option value="FAILED">Com falha</option>
      </Select>
      {isLoading && <p className="text-sm text-muted">Carregando…</p>}
      {data?.length === 0 && <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted">Nenhuma mensagem registrada.</p>}
      <Card className="divide-y divide-border">
        {data?.map((m) => (
          <div key={m.id} className="px-4 py-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-medium">{m.clientName ?? "—"}</span>
              <span className={m.status === "SENT" ? "text-status-running" : m.status === "FAILED" ? "text-status-error" : "text-muted"}>
                {m.status === "SENT" ? "✓ Enviada" : m.status === "FAILED" ? "Falhou" : "Enviando"} · {m.kind === "MANUAL" ? "manual" : "automática"}
              </span>
            </div>
            <p className="text-xs text-muted">
              {formatDateTimeBR(m.sentAt ?? m.createdAt)} · +{m.toPhone}
              {m.chargeDescription ? ` · ${m.chargeDescription}` : ""}
            </p>
            {m.error && <p className="mt-1 text-xs text-status-error">{m.error}</p>}
          </div>
        ))}
      </Card>
    </div>
  );
}
