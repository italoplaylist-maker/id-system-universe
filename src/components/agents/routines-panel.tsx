"use client";

import { useEffect, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { DAY_LABELS, ROUTINE_GATES, ROUTINE_PRIORITIES, isValidTime } from "@/lib/clt-routines";
import { useRoomAgents, useRoutineMutations, useRoutines, type RoutineView } from "@/hooks/use-orchestrator";

const field = "rounded-md border border-border bg-surface px-2 py-1.5 text-xs focus:border-accent focus:outline-none";

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "nunca";
}

/** Um cartão por rotina: edita localmente e só grava ao salvar (nada muda sozinho enquanto você mexe). */
function RoutineCard({ routine, canWrite }: { routine: RoutineView; canWrite: boolean }) {
  const { data: agents } = useRoomAgents(true);
  const { update, run } = useRoutineMutations();
  const [f, setF] = useState({ enabled: routine.enabled, days: routine.days, time: routine.time, priority: routine.priority, gate: routine.gate, agentId: routine.agentId, prompt: routine.prompt });
  const [open, setOpen] = useState(false);
  // O servidor é a fonte da verdade: depois de salvar/atualizar, o cartão acompanha.
  const serverKey = `${routine.enabled}|${routine.days.join()}|${routine.time}|${routine.priority}|${routine.gate}|${routine.agentId}|${routine.prompt}`;
  useEffect(() => {
    setF({ enabled: routine.enabled, days: routine.days, time: routine.time, priority: routine.priority, gate: routine.gate, agentId: routine.agentId, prompt: routine.prompt }); // eslint-disable-line react-hooks/set-state-in-effect
  }, [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = serverKey !== `${f.enabled}|${f.days.join()}|${f.time}|${f.priority}|${f.gate}|${f.agentId}|${f.prompt}`;
  const valid = isValidTime(f.time) && f.days.length > 0 && f.prompt.trim().length >= 10;
  const gate = ROUTINE_GATES.find((g) => g.id === f.gate);

  return (
    <li className={cn("space-y-2 rounded-xl border bg-surface p-3 text-xs", f.enabled ? "border-border" : "border-border opacity-70")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{routine.name}</p>
          <p className="text-muted">{routine.agentName} · {routine.schedule}</p>
        </div>
        <label className="flex shrink-0 items-center gap-1.5 text-muted">
          <input type="checkbox" checked={f.enabled} disabled={!canWrite} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
          Ligada
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Dias da semana">
        {DAY_LABELS.map((d, i) => {
          const on = f.days.includes(i);
          return (
            <button
              key={d}
              type="button"
              disabled={!canWrite}
              onClick={() => setF({ ...f, days: on ? f.days.filter((x) => x !== i) : [...f.days, i].sort((a, b) => a - b) })}
              className={cn("rounded px-2 py-1 font-medium", on ? "bg-accent/20 text-foreground ring-1 ring-accent/60" : "text-muted ring-1 ring-border hover:text-foreground")}
              aria-pressed={on}
            >
              {d}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-muted">
          Horário (SP)
          <input type="time" className={field} value={f.time} disabled={!canWrite} onChange={(e) => setF({ ...f, time: e.target.value })} />
        </label>
        <label className="flex items-center gap-1 text-muted">
          Prioridade
          <select className={field} value={f.priority} disabled={!canWrite} onChange={(e) => setF({ ...f, priority: Number(e.target.value) })}>
            {ROUTINE_PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-muted">
          Agente
          <select className={field} value={f.agentId} disabled={!canWrite} onChange={(e) => setF({ ...f, agentId: e.target.value })}>
            {(agents ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      </div>

      <label className="flex flex-wrap items-center gap-1 text-muted">
        Gatilho
        <select className={field} value={f.gate} disabled={!canWrite} onChange={(e) => setF({ ...f, gate: e.target.value as RoutineView["gate"] })}>
          {ROUTINE_GATES.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
        <span className="text-[11px]">{gate?.help}</span>
      </label>

      <button type="button" className="text-[11px] text-muted underline" onClick={() => setOpen((v) => !v)}>{open ? "Ocultar instrução" : "Ver/editar instrução"}</button>
      {open && <textarea className={`${field} h-40 w-full`} value={f.prompt} disabled={!canWrite} maxLength={6000} onChange={(e) => setF({ ...f, prompt: e.target.value })} />}

      <p className="text-[11px] text-muted">
        Última verificação: {when(routine.lastRunAt)} — {routine.lastOutcome ?? "ainda não rodou"}
      </p>

      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={!dirty || !valid || update.isPending}
            onClick={() => update.mutate({ id: routine.id, ...f }, { onSuccess: () => toast.success("Rotina salva."), onError: (e) => toast.error(e.message) })}
          >
            {update.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Salvar"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={run.isPending || dirty}
            title={dirty ? "Salve antes de executar" : "Ignora horário e gatilho; respeita o limite de tokens"}
            onClick={() => run.mutate(routine.id, { onSuccess: (r) => (r.started ? toast.success("Rotina enviada ao agente.") : toast.message(r.outcome)), onError: (e) => toast.error(e.message) })}
          >
            {run.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}Executar agora
          </Button>
        </div>
      )}
    </li>
  );
}

/** Rotinas agendadas da equipe: o servidor dispara sozinho nos horários (fuso de São Paulo), sem precisar do navegador aberto. */
export function RoutinesPanel({ canWrite, onBack }: { canWrite: boolean; onBack: () => void }) {
  const { data: routines, isLoading } = useRoutines(true);
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <button className="text-xs text-muted hover:text-foreground" onClick={onBack}>← Voltar</button>
        <h3 className="text-sm font-medium text-foreground">Rotinas agendadas</h3>
      </div>
      <p className="text-[11px] leading-snug text-muted">
        Rodam no servidor, no horário de São Paulo, mesmo com o Universe fechado. Cada rotina só chama o Claude se o gatilho confirmar que há o que fazer — assim os agentes não gastam tokens à toa. O limite de tokens de cada agente continua valendo.
      </p>
      {isLoading && <p className="text-xs text-muted">Carregando…</p>}
      {routines && routines.length === 0 && <p className="text-xs text-muted">Nenhuma rotina ainda. Crie a equipe AGENTES CLT para receber as rotinas padrão.</p>}
      <ul className="space-y-3">{routines?.map((r) => <RoutineCard key={r.id} routine={r} canWrite={canWrite} />)}</ul>
    </div>
  );
}
