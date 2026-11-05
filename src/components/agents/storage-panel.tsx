"use client";

import { useState } from "react";
import { HardDrive, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useCleanStorage, useStorageReport } from "@/hooks/use-orchestrator";

const mb = (b: number) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : `${Math.round(b / 1048576)} MB`);

/** Uso de disco e memória do servidor + botão de faxina segura (só apaga o que é regenerável). */
export function StoragePanel() {
  const [open, setOpen] = useState(false);
  const { data, isFetching } = useStorageReport(open);
  const clean = useCleanStorage();
  const r = data?.report;

  return (
    <div className="border-t border-border px-4 py-2 text-xs">
      <button className="flex items-center gap-1.5 text-muted hover:text-foreground" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <HardDrive className="h-3.5 w-3.5" />
        Armazenamento do servidor{r ? ` · ${mb(r.totalBytes)}` : ""}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {!r || isFetching ? (
            <p className="flex items-center gap-1.5 text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />Medindo…</p>
          ) : (
            <>
              <ul className="space-y-0.5 text-muted">
                <li>Cópias dos agentes: <b className="text-foreground">{mb(r.workspaces.bytes)}</b>{r.workspaces.orphanBytes > 0 ? ` (${mb(r.workspaces.orphanBytes)} sem dono)` : ""}</li>
                <li>Dados do Claude (~/.claude): <b className="text-foreground">{mb(r.claude.bytes)}</b> · transcrições {mb(r.claude.transcriptsBytes)}</li>
                <li>Anexos: <b className="text-foreground">{mb(r.attachments.bytes)}</b></li>
                <li>Banco: {r.database.taskEvents.toLocaleString("pt-BR")} eventos de tarefas · {r.database.universeEvents.toLocaleString("pt-BR")} do Universe</li>
                <li>Memória do Universe: <b className="text-foreground">{r.memory.rssMB} MB</b> (heap {r.memory.heapUsedMB} MB)</li>
              </ul>
              {r.workspaces.agents.filter((a) => a.heavyBytes > 0).map((a) => (
                <p key={a.agentId} className="text-muted">
                  {a.name}: {mb(a.bytes)} · dependências/builds {mb(a.heavyBytes)}{a.busy ? " · trabalhando" : a.idleHours !== null ? ` · parado há ${a.idleHours} h` : ""}
                </p>
              ))}
              <button
                className="rounded border border-border px-2 py-1 text-foreground hover:bg-surface disabled:opacity-50"
                disabled={clean.isPending}
                onClick={() =>
                  clean.mutate(undefined, {
                    onSuccess: (d) => toast.success(d.result.freedBytes > 0 ? `Liberei ${mb(d.result.freedBytes)}.` : "Nada para limpar agora."),
                    onError: (e) => toast.error(e.message),
                  })
                }
              >
                {clean.isPending ? "Limpando…" : "Limpar agora"}
              </button>
              <p className="text-[11px] text-muted">Só apaga o que volta sozinho: node_modules/builds ignorados pelo Git de agentes sem tarefa ativa, transcrições e caches velhos. Código sem commit nunca é tocado. A faxina também roda sozinha a cada 6 h.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
