"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, MessageSquare, Play, Send, Square, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatAgo } from "@/lib/format-metrics";
import { useAgentCommandMutations, useAgentCommands, useAgentTimeline, type AgentTimelineItem } from "@/hooks/use-agents";
import { agentTitle } from "@/components/universe/hq/office/agent-desk";

const STATE = { WORKING: { label: "Trabalhando", cls: "text-status-deploying" }, IDLE: { label: "Aguardando", cls: "text-muted" }, ERROR: { label: "Erro na ferramenta", cls: "text-status-error" } } as const;

function describe(e: AgentTimelineItem): { icon: React.ReactNode; text: string } {
  switch (e.kind) {
    case "session_start": return { icon: <Play className="h-3.5 w-3.5 text-status-running" />, text: "Sessão iniciada" };
    case "prompt": return { icon: <MessageSquare className="h-3.5 w-3.5 text-accent" />, text: "Novo pedido recebido" };
    case "stop": return { icon: <CheckCircle2 className="h-3.5 w-3.5 text-status-running" />, text: "Terminou a resposta" };
    case "notify": return { icon: <AlertTriangle className="h-3.5 w-3.5 text-status-warning" />, text: "Aguardando você (aviso)" };
    case "session_end": return { icon: <Square className="h-3.5 w-3.5 text-muted" />, text: "Sessão encerrada" };
    default:
      return {
        icon: e.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-muted" /> : <AlertTriangle className="h-3.5 w-3.5 text-status-error" />,
        text: `${e.tool ?? "Ferramenta"}${e.target ? ` · ${e.target}` : ""}${e.ok ? "" : " — falhou"}`,
      };
  }
}

function CommandBox({ sessionId, idle }: { sessionId: string; idle: boolean }) {
  const [text, setText] = useState("");
  const { data: commands } = useAgentCommands(sessionId);
  const { send, cancel } = useAgentCommandMutations(sessionId);
  const submit = async () => {
    try {
      await send.mutateAsync(text);
      setText("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao enviar o pedido.");
    }
  };
  return (
    <div className="space-y-2 border-b border-border p-4">
      <label htmlFor="agent-command" className="text-xs font-medium text-foreground">Enviar pedido ao agente</label>
      <textarea
        id="agent-command"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) void submit();
        }}
        maxLength={2000}
        rows={3}
        placeholder="Ex.: depois disso, rode os testes e me diga o resultado"
        className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] leading-snug text-muted">
          {idle
            ? "O agente está aguardando você: o pedido entra na sua próxima mensagem ou quando ele voltar a trabalhar."
            : "Chega quando o agente terminar o passo atual — não interrompe o que ele está fazendo."}
        </p>
        <Button size="sm" variant="primary" disabled={!text.trim() || send.isPending} onClick={() => void submit()}>
          <Send className="h-3.5 w-3.5" />Enviar
        </Button>
      </div>
      {commands && commands.length > 0 && (
        <ul className="space-y-1.5 pt-1">
          {commands.map((c) => (
            <li key={c.id} className="flex items-start gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-xs">
              {c.status === "PENDING" ? <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-warning" /> : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-running" />}
              <div className="min-w-0 flex-1">
                <p className="break-words text-foreground">{c.text}</p>
                <p className="text-muted">
                  {c.status === "PENDING" ? "Na fila — aguardando o agente" : `Entregue às ${new Date(c.deliveredAt ?? c.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`}
                </p>
              </div>
              {c.status === "PENDING" && (
                <button type="button" className="text-muted hover:text-foreground" onClick={() => cancel.mutate(c.id)} aria-label="Cancelar pedido">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TimelinePanel({ sessionId, onClose, canSend = false }: { sessionId: string; onClose: () => void; canSend?: boolean }) {
  const { data, isLoading } = useAgentTimeline(sessionId);
  const s = data?.session;
  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-full max-w-sm flex-col border-l border-border bg-surface-raised/95 shadow-2xl backdrop-blur">
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-muted">Agente Claude</p>
          <h2 className="truncate text-base font-semibold text-foreground">{s ? agentTitle(s) : "…"}</h2>
          {s && <p className="truncate text-xs text-muted">{s.branch ?? "—"}{s.model ? ` · ${s.model}` : ""}</p>}
          {s && <p className={cn("mt-1 text-xs font-medium", STATE[s.state].cls)}>{STATE[s.state].label}{s.activity ? ` — ${s.activity}` : ""}</p>}
        </div>
        <button onClick={onClose} className="rounded p-1 text-muted hover:bg-surface hover:text-foreground" aria-label="Fechar"><X className="h-4 w-4" /></button>
      </div>
      {s && (
        <div className="grid grid-cols-3 border-b border-border text-center text-xs">
          <div className="p-3"><p className="text-lg font-semibold tabular-nums">{s.toolCount}</p><p className="text-muted">ferramentas</p></div>
          <div className="p-3"><p className={cn("text-lg font-semibold tabular-nums", s.failedCount > 0 && "text-status-error")}>{s.failedCount}</p><p className="text-muted">falhas</p></div>
          <div className="p-3"><p className="text-lg font-semibold">{formatAgo(s.lastEventAt).replace("há ", "")}</p><p className="text-muted">último sinal</p></div>
        </div>
      )}
      {canSend && s && <CommandBox sessionId={sessionId} idle={s.state === "IDLE"} />}
      <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto text-sm">
        {data?.events.map((e) => {
          const d = describe(e);
          return (
            <li key={e.id} className="flex items-start gap-2.5 px-4 py-2.5">
              <span className="mt-0.5 shrink-0">{d.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-foreground">{d.text}</p>
                <time dateTime={e.ts} className="text-xs tabular-nums text-muted">{new Date(e.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
              </div>
            </li>
          );
        })}
        {!isLoading && data?.events.length === 0 && <li className="px-4 py-4 text-muted">Nenhum evento registrado.</li>}
      </ul>
    </aside>
  );
}
