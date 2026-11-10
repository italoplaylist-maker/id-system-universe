"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { useSystemErrors } from "@/hooks/use-orchestrator";

const WINDOWS = [
  { hours: 24, label: "24 h" },
  { hours: 72, label: "3 dias" },
  { hours: 168, label: "7 dias" },
  { hours: 720, label: "30 dias" },
] as const;

const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Erros que os sistemas escreveram nos logs, agrupados. Os agentes CLT leem os mesmos dados (ferramenta listar_erros). Sem notificações. */
export function ErrorsPanel({ onBack }: { onBack: () => void }) {
  const [hours, setHours] = useState<number>(24);
  const [open, setOpen] = useState<string | null>(null);
  const { data: errors, isLoading } = useSystemErrors(hours, true);
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <button className="text-xs text-muted hover:text-foreground" onClick={onBack}>← Voltar</button>
        <h3 className="text-sm font-medium text-foreground">Erros dos sistemas</h3>
      </div>
      <p className="text-[11px] leading-snug text-muted">
        O servidor lê os logs de todos os sistemas a cada 15 minutos e agrupa os erros: o mesmo erro com horas e números diferentes é um item só. Os agentes CLT leem estes mesmos dados. Nada é enviado a você: é só olhar aqui quando quiser.
      </p>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Período">
        {WINDOWS.map((w) => (
          <button key={w.hours} onClick={() => setHours(w.hours)} aria-pressed={hours === w.hours} className={cn("rounded px-2 py-1 text-xs", hours === w.hours ? "bg-accent/20 text-foreground ring-1 ring-accent/60" : "text-muted ring-1 ring-border hover:text-foreground")}>
            {w.label}
          </button>
        ))}
      </div>
      {isLoading && <p className="text-xs text-muted">Carregando…</p>}
      {errors && errors.length === 0 && <p className="text-xs text-muted">Nenhum erro registrado neste período. (A primeira leitura de cada sistema só marca o ponto de partida: erros já presentes no fim do log naquele momento não entram.)</p>}
      <ul className="space-y-2">
        {errors?.map((e) => (
          <li key={e.id} className="rounded-lg border border-border bg-surface text-xs">
            <button className="flex w-full items-start justify-between gap-2 px-3 py-2 text-left" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
              <span className="min-w-0">
                <span className="block font-medium text-foreground">{e.project ? `${e.project} / ` : ""}{e.application}</span>
                <span className="block truncate font-mono text-[11px] text-status-error">{e.sample.split("\n")[0]}</span>
              </span>
              <span className="shrink-0 text-right text-muted">
                <span className="block font-semibold text-foreground">{e.count}×</span>
                <span className="block">última {when(e.lastSeenAt)}</span>
              </span>
            </button>
            {open === e.id && (
              <div className="border-t border-border px-3 py-2">
                <p className="mb-1 text-[11px] text-muted">Primeira vez: {when(e.firstSeenAt)}</p>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-foreground/90">{e.sample}</pre>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
