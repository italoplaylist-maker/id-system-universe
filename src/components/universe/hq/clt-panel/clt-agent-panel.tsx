"use client";

import { useState } from "react";
import { AlertCircle, AlertTriangle, Ban, CheckCircle2, ChevronDown, ChevronRight, Clock, Loader2, PauseCircle, Play, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { DASHBOARD_DAYS, MAX_DELEGATIONS_PER_DAY } from "@/lib/clt-dashboard";
import { ROUTINE_GATES } from "@/lib/clt-routines";
import { fmtTokens } from "@/lib/claude-usage";
import { useCltDashboard, useOrchestratorMutations, type CltDashboardView } from "@/hooks/use-orchestrator";
import { DayBarChart, Meter, RankBars, SERIES, STATUS, StatTile } from "./charts";

type Tab = "resumo" | "operacao" | "equipe" | "tarefas" | "rotinas" | "conversar";

const STATE: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  AVAILABLE: { label: "Disponível", color: STATUS.good, icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  DONE: { label: "Concluiu", color: STATUS.good, icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  RECEIVING: { label: "Comando recebido", color: SERIES.blue, icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
  RUNNING: { label: "Executando", color: SERIES.blue, icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
  WAITING: { label: "Aguarda aprovação", color: STATUS.warning, icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  ERROR: { label: "Com erro", color: STATUS.critical, icon: <AlertCircle className="h-3.5 w-3.5" /> },
  PAUSED: { label: "Pausado", color: "#8890a3", icon: <PauseCircle className="h-3.5 w-3.5" /> },
};

const TASK_STATUS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  COMPLETED: { label: "Concluída", color: STATUS.good, icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  FAILED: { label: "Falhou", color: STATUS.critical, icon: <AlertCircle className="h-3.5 w-3.5" /> },
  INTERRUPTED: { label: "Interrompida", color: STATUS.critical, icon: <AlertCircle className="h-3.5 w-3.5" /> },
  CANCELLED: { label: "Cancelada", color: "#8890a3", icon: <Ban className="h-3.5 w-3.5" /> },
  QUEUED: { label: "Na fila", color: STATUS.warning, icon: <Clock className="h-3.5 w-3.5" /> },
  STARTING: { label: "Iniciando", color: SERIES.blue, icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
  RUNNING: { label: "Executando", color: SERIES.blue, icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
  WAITING_APPROVAL: { label: "Aguarda aprovação", color: STATUS.warning, icon: <AlertTriangle className="h-3.5 w-3.5" /> },
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const dur = (s: number | null) => (s === null ? "—" : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`);
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Selo de situação: cor + ÍCONE + rótulo (a cor nunca carrega o significado sozinha). */
function Pill({ meta }: { meta: { label: string; color: string; icon: React.ReactNode } }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium" style={{ color: meta.color, background: `${meta.color}1f` }}>
      {meta.icon}
      <span className="text-foreground">{meta.label}</span>
    </span>
  );
}

function TaskList({ tasks }: { tasks: CltDashboardView["recentTasks"] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (tasks.length === 0) return <p className="rounded-xl border border-border bg-surface-raised p-6 text-center text-sm text-muted">Nenhuma tarefa ainda.</p>;
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-raised">
      {tasks.map((t) => {
        const st = TASK_STATUS[t.status] ?? TASK_STATUS.QUEUED;
        const expanded = open === t.id;
        return (
          <li key={t.id}>
            <button className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface" onClick={() => setOpen(expanded ? null : t.id)} aria-expanded={expanded}>
              {expanded ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">{t.prompt}</span>
                <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                  <Pill meta={st} />
                  <span>{when(t.finishedAt ?? t.startedAt)}</span>
                  {t.tokens > 0 && <span>{fmtTokens(t.tokens)} tokens</span>}
                  {t.fromRoutine && <span className="rounded border border-border px-1.5">rotina</span>}
                  {t.delegated && <span className="rounded border border-border px-1.5">delegada</span>}
                </span>
              </span>
            </button>
            {expanded && (
              <div className="space-y-2 border-t border-border bg-background/40 px-4 py-3 text-xs">
                <p className="whitespace-pre-wrap break-words text-muted">{t.prompt}</p>
                {t.result && <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface p-3 text-foreground/90">{t.result}</pre>}
                {t.error && <p className="whitespace-pre-wrap break-words rounded-lg border p-3" style={{ borderColor: `${STATUS.critical}66`, color: STATUS.critical }}>{t.error}</p>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function RoutineList({ routines }: { routines: CltDashboardView["routines"] }) {
  if (routines.length === 0) return <p className="rounded-xl border border-border bg-surface-raised p-6 text-center text-sm text-muted">Este agente não tem rotinas agendadas.</p>;
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-raised">
      {routines.map((r) => (
        <li key={r.id} className="space-y-1 px-4 py-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <p className="font-medium text-foreground">{r.name}</p>
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px]", r.enabled ? "bg-accent/15 text-foreground" : "bg-surface text-muted")}>{r.enabled ? "Ligada" : "Desligada"}</span>
          </div>
          <p className="text-xs text-muted">{r.schedule} · gatilho: {ROUTINE_GATES.find((g) => g.id === r.gate)?.label ?? r.gate} · prioridade {r.priority > 0 ? "alta" : r.priority < 0 ? "baixa" : "normal"}</p>
          <p className="text-xs text-muted">Última verificação: {when(r.lastRunAt)} — {r.lastOutcome ?? "ainda não rodou"}</p>
        </li>
      ))}
    </ul>
  );
}

function Resumo({ d }: { d: CltDashboardView }) {
  const a = d.agent;
  const t = d.kpis.tasks;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Tokens hoje" value={fmtTokens(a.usage.usedDay)} hint={a.dailyTokenLimit ? `limite ${fmtTokens(a.dailyTokenLimit)}` : "sem limite"}>
          <Meter percent={a.usage.dayPercent} label="Uso diário de tokens" />
        </StatTile>
        <StatTile label="Tokens no mês" value={fmtTokens(a.usage.usedMonth)} hint={a.monthlyTokenLimit ? `limite ${fmtTokens(a.monthlyTokenLimit)}` : "sem limite"}>
          <Meter percent={a.usage.monthPercent} label="Uso mensal de tokens" />
        </StatTile>
        <StatTile label={`Tarefas em ${DASHBOARD_DAYS} dias`} value={t.completed + t.failed} hint={`${t.completed} concluídas · ${t.failed} falhas`} />
        <StatTile label="Taxa de sucesso" value={d.kpis.successRate === null ? "—" : `${d.kpis.successRate}%`} hint={`tempo médio ${dur(d.kpis.avgSeconds)}`} />
      </div>
      <DayBarChart title="Tokens por dia" subtitle={`Últimos ${DASHBOARD_DAYS} dias · entrada + saída + cache`} days={d.days} series={[{ key: "tokens", label: "Tokens", color: SERIES.blue, values: d.tokensByDay }]} format={fmtTokens} />
      <DayBarChart
        title="Tarefas por dia"
        subtitle="Concluídas e com falha"
        days={d.days}
        series={[
          { key: "ok", label: "Concluídas", color: SERIES.blue, values: d.tasksByDay.completed },
          { key: "fail", label: "Falhas", color: SERIES.orange, values: d.tasksByDay.failed },
        ]}
      />
    </div>
  );
}

function Operacao({ d }: { d: CltDashboardView }) {
  const op = d.operation;
  const [open, setOpen] = useState<string | null>(null);
  if (!op) return null;
  const apps = op.appStatus;
  const totalApps = Object.values(apps).reduce((a, b) => a + b, 0);
  const deploysOk = op.deploysByDay.success.reduce((a, b) => a + b, 0);
  const deploysFail = op.deploysByDay.failed.reduce((a, b) => a + b, 0);
  const errors7 = op.errorsByDay.slice(-7).reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Sistemas" value={totalApps} hint={`${apps.RUNNING ?? 0} no ar · ${apps.ERROR ?? 0} com erro · ${apps.DEPLOYING ?? 0} implantando`}>
          {(apps.ERROR ?? 0) > 0 ? <Pill meta={{ label: `${apps.ERROR} com erro`, color: STATUS.critical, icon: <AlertCircle className="h-3.5 w-3.5" /> }} /> : <Pill meta={{ label: "Sem sistema em erro", color: STATUS.good, icon: <CheckCircle2 className="h-3.5 w-3.5" /> }} />}
        </StatTile>
        <StatTile label="Servidores" value={op.servers.online + op.servers.offline} hint={`${op.servers.online} online · ${op.servers.offline} offline · ${op.servers.inAlert} em alerta`}>
          {op.servers.offline > 0 ? <Pill meta={{ label: `${op.servers.offline} offline`, color: STATUS.critical, icon: <AlertCircle className="h-3.5 w-3.5" /> }} /> : op.servers.inAlert > 0 ? <Pill meta={{ label: `${op.servers.inAlert} em alerta`, color: STATUS.warning, icon: <AlertTriangle className="h-3.5 w-3.5" /> }} /> : <Pill meta={{ label: "Tudo normal", color: STATUS.good, icon: <CheckCircle2 className="h-3.5 w-3.5" /> }} />}
        </StatTile>
        <StatTile label={`Erros em 7 dias`} value={errors7.toLocaleString("pt-BR")} hint={`${op.topErrors.length} tipo(s) de erro recente(s)`} />
        <StatTile label="Delegações hoje" value={`${op.delegationsToday}/${MAX_DELEGATIONS_PER_DAY}`} hint={`deploys em ${DASHBOARD_DAYS} dias: ${deploysOk} ok · ${deploysFail} falhos`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <DayBarChart title="Erros por dia" subtitle="Todos os sistemas, lidos dos logs a cada 15 min" days={d.days} series={[{ key: "err", label: "Erros", color: SERIES.blue, values: op.errorsByDay }]} format={(n) => n.toLocaleString("pt-BR")} emptyText="Nenhum erro registrado no período." />
        <DayBarChart title="Deploys por dia" subtitle="Com sucesso e falhos" days={d.days} series={[{ key: "ok", label: "Sucesso", color: SERIES.blue, values: op.deploysByDay.success }, { key: "fail", label: "Falhos", color: SERIES.orange, values: op.deploysByDay.failed }]} emptyText="Nenhum deploy no período." />
      </div>

      <RankBars title="Sistemas com mais erros" subtitle="Últimos 7 dias" items={op.errorsBySystem.map((s) => ({ name: s.name, value: s.count }))} emptyText="Nenhum sistema com erro nos últimos 7 dias." />

      <section className="overflow-hidden rounded-xl border border-border bg-surface-raised" aria-label="Erros mais recentes">
        <header className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">Erros mais recentes</h3>
          <p className="text-xs text-muted">Agrupados: o mesmo erro com horas e números diferentes é um item só.</p>
        </header>
        {op.topErrors.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted">Nenhum erro registrado nos últimos 7 dias.</p>
        ) : (
          <ul className="divide-y divide-border">
            {op.topErrors.map((e) => (
              <li key={e.id}>
                <button className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-surface" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{e.project ? `${e.project} / ` : ""}{e.application}</span>
                    <span className="block truncate font-mono text-[11px] text-muted">{e.sample.split("\n")[0]}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-muted">
                    <strong className="block text-sm tabular-nums text-foreground">{e.count}×</strong>
                    última {when(e.lastSeenAt)}
                  </span>
                </button>
                {open === e.id && <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all border-t border-border bg-background/40 px-4 py-3 font-mono text-[11px] text-foreground/90">{e.sample}</pre>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-surface-raised" aria-label="Delegações recentes">
        <header className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">Delegações recentes</h3>
          <p className="text-xs text-muted">Tarefas que o ID Manager passou aos especialistas (máx. {MAX_DELEGATIONS_PER_DAY} por dia).</p>
        </header>
        {op.delegations.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted">O ID Manager ainda não delegou nenhuma tarefa.</p>
        ) : (
          <ul className="divide-y divide-border">
            {op.delegations.map((x) => (
              <li key={x.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate text-foreground">{x.prompt}</span>
                  <span className="text-xs text-muted">para {x.to} · {when(x.at)}</span>
                </span>
                <Pill meta={TASK_STATUS[x.status] ?? TASK_STATUS.QUEUED} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Equipe({ d, onSelect }: { d: CltDashboardView; onSelect: (id: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {d.team.map((m) => (
        <button key={m.id} onClick={() => onSelect(m.id)} className={cn("rounded-xl border bg-surface-raised p-4 text-left transition-colors hover:border-accent", m.id === d.agent.id ? "border-accent" : "border-border")}>
          <div className="mb-2 flex items-start justify-between gap-2">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-foreground">{m.name}</span>
              <span className="block truncate text-xs text-muted">{m.roleTitle ?? "—"}</span>
            </span>
            <Pill meta={STATE[m.state] ?? STATE.AVAILABLE} />
          </div>
          <Meter percent={m.dayPercent} label={`Tokens de hoje — ${m.name}`} />
          <p className="mt-1.5 text-[11px] text-muted">{m.running} rodando · {m.pending} na fila</p>
        </button>
      ))}
    </div>
  );
}

function Conversar({ d, canWrite }: { d: CltDashboardView; canWrite: boolean }) {
  const { submit } = useOrchestratorMutations();
  const [text, setText] = useState("");
  const a = d.agent;
  const last = d.recentTasks[0];
  const send = () => {
    if (!text.trim() || submit.isPending) return;
    submit.mutate(
      { agentId: a.id, prompt: text.trim(), idempotencyKey: newKey() },
      { onSuccess: () => { setText(""); toast.success(`Tarefa enviada a ${a.name}.`); }, onError: (e) => toast.error(e.message) },
    );
  };
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-surface-raised p-4">
        <h3 className="mb-1 text-sm font-semibold text-foreground">Função de {a.name}</h3>
        <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted">{a.description ?? "Sem função definida."}</p>
      </section>
      {canWrite ? (
        <section className="rounded-xl border border-border bg-surface-raised p-4">
          <label htmlFor="clt-chat" className="mb-2 block text-sm font-semibold text-foreground">Enviar instrução a {a.name}</label>
          <textarea id="clt-chat" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }} rows={4} maxLength={20000} disabled={a.paused} placeholder={a.paused ? "Agente pausado" : "Ex.: confira os erros do Construsil desta manhã e me diga a causa mais provável"} className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:opacity-60" />
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted">Ctrl+Enter envia. A tarefa entra na fila do agente e respeita o limite de tokens.</p>
            <Button size="sm" variant="primary" disabled={!text.trim() || submit.isPending || a.paused} onClick={send}>
              {submit.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Enviar
            </Button>
          </div>
        </section>
      ) : (
        <p className="text-xs text-muted">Você não tem permissão para enviar tarefas.</p>
      )}
      {last && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-foreground">Última tarefa</h3>
          <TaskList tasks={[last]} />
        </section>
      )}
    </div>
  );
}

/**
 * Painel da equipe AGENTES CLT: abre ao clicar num funcionário na sala. Mostra a situação real, tokens e tarefas por dia,
 * rotinas e histórico; no ID Manager, a visão da operação (sistemas, servidores, erros, deploys e delegações).
 */
export function CltAgentPanel({ agentId, canWrite, onClose, onSelectAgent, onOpenCenter }: { agentId: string; canWrite: boolean; onClose: () => void; onSelectAgent: (id: string) => void; onOpenCenter: () => void }) {
  const { data: d, isLoading, error } = useCltDashboard(agentId, true);
  const { updateAgent } = useOrchestratorMutations();
  const isManager = d?.agent.slug === "id-manager";
  const tabs: Array<{ id: Tab; label: string }> = isManager
    ? [{ id: "operacao", label: "Operação" }, { id: "resumo", label: "Resumo" }, { id: "equipe", label: "Equipe" }, { id: "tarefas", label: "Tarefas" }, { id: "rotinas", label: "Rotinas" }, { id: "conversar", label: "Conversar" }]
    : [{ id: "resumo", label: "Resumo" }, { id: "tarefas", label: "Tarefas" }, { id: "rotinas", label: "Rotinas" }, { id: "conversar", label: "Conversar" }];
  const [tab, setTab] = useState<Tab | null>(null);
  const current: Tab = tab && tabs.some((t) => t.id === tab) ? tab : tabs[0].id;
  const a = d?.agent;

  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-full max-w-4xl flex-col border-l border-border bg-background/97 shadow-2xl backdrop-blur" aria-label={a ? `Painel de ${a.name}` : "Painel do agente"}>
      <header className="shrink-0 border-b border-border px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-muted">AGENTES CLT{a?.roleTitle ? ` · ${a.roleTitle}` : ""}</p>
            <h2 className="truncate text-xl font-semibold text-foreground">{a?.name ?? "Carregando…"}</h2>
            {a && <p className="mt-0.5 truncate text-xs text-muted">{a.activity ?? a.specialty ?? "—"}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {a && <Pill meta={STATE[a.state] ?? STATE.AVAILABLE} />}
            <button onClick={onClose} className="rounded-lg p-2 text-muted hover:bg-surface hover:text-foreground" aria-label="Fechar"><X className="h-4 w-4" /></button>
          </div>
        </div>
        {a && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            {a.model && <span className="rounded border border-border px-2 py-0.5 text-muted">modelo {a.model}</span>}
            {a.effort && <span className="rounded border border-border px-2 py-0.5 text-muted">esforço {a.effort}</span>}
            {a.currentTask && <span className="max-w-[22rem] truncate rounded border border-border px-2 py-0.5 text-muted" title={a.currentTask.prompt}>tarefa atual: {a.currentTask.prompt}</span>}
            <span className="ml-auto flex gap-2">
              {canWrite && (
                <Button size="sm" variant="secondary" disabled={updateAgent.isPending} onClick={() => updateAgent.mutate({ id: a.id, paused: !a.paused }, { onError: (e) => toast.error(e.message) })}>
                  {a.paused ? <Play className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}{a.paused ? "Retomar" : "Pausar"}
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={onOpenCenter}>Abrir na Central</Button>
            </span>
          </div>
        )}
        <div role="tablist" aria-label="Seções" className="mt-4 flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={current === t.id} onClick={() => setTab(t.id)} className={cn("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm", current === t.id ? "bg-accent/20 font-medium text-foreground ring-1 ring-accent/50" : "text-muted hover:bg-surface hover:text-foreground")}>
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
        {isLoading && <p className="text-sm text-muted">Carregando dados do agente…</p>}
        {error && <p className="text-sm" style={{ color: STATUS.critical }}>Não consegui carregar o painel: {error instanceof Error ? error.message : "erro desconhecido"}.</p>}
        {d && current === "operacao" && <Operacao d={d} />}
        {d && current === "resumo" && <Resumo d={d} />}
        {d && current === "equipe" && <Equipe d={d} onSelect={onSelectAgent} />}
        {d && current === "tarefas" && <TaskList tasks={d.recentTasks} />}
        {d && current === "rotinas" && <RoutineList routines={d.routines} />}
        {d && current === "conversar" && <Conversar d={d} canWrite={canWrite} />}
      </div>
    </aside>
  );
}
