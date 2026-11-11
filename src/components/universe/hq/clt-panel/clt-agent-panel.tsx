"use client";

import { useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, Ban, CheckCircle2, ChevronDown, ChevronRight, Clock, Loader2, PauseCircle, Play, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { HUMAN_ACTION_LABEL, type HumanActionKind } from "@/lib/fix-queue";
import { DASHBOARD_DAYS, MAX_DELEGATIONS_PER_DAY } from "@/lib/clt-dashboard";
import { ROUTINE_GATES } from "@/lib/clt-routines";
import { fmtTokens } from "@/lib/claude-usage";
import { useCltDashboard, useFixMutations, useFixQueue, useIncidentMutations, useOrchestratorMutations, type CltDashboardView } from "@/hooks/use-orchestrator";
import { DayBarChart, Meter, RankBars, SERIES, STATUS, StatTile } from "./charts";

type Tab = "correcoes" | "resumo" | "operacao" | "equipe" | "tarefas" | "rotinas" | "conversar";

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
        <StatTile label="Eficiência" value={d.kpis.efficiency.tokensPerTask === null ? "—" : fmtTokens(d.kpis.efficiency.tokensPerTask)} hint={`por tarefa concluída · ${d.kpis.efficiency.cachePercent ?? 0}% cache · ${d.kpis.efficiency.wastedPercent ?? 0}% perdido em falhas`} />
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

const INCIDENT_STATUS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  OPEN: { label: "Em conserto", color: STATUS.warning, icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
  RESOLVED: { label: "Resolvido", color: STATUS.good, icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  ESCALATED: { label: "Precisa de você", color: STATUS.critical, icon: <AlertCircle className="h-3.5 w-3.5" /> },
};

/** Incidentes de deploy falho: o que a equipe está consertando, quem ficou bloqueado e as ações humanas (liberar / dar por resolvido). */
function Incidentes({ incidents, canWrite }: { incidents: NonNullable<CltDashboardView["operation"]>["incidents"]; canWrite: boolean }) {
  const { act } = useIncidentMutations();
  const [open, setOpen] = useState<string | null>(null);
  const attention = incidents.filter((i) => i.status !== "RESOLVED").length;
  return (
    <section className="overflow-hidden rounded-xl border bg-surface-raised" style={{ borderColor: attention ? `${STATUS.warning}66` : undefined }} aria-label="Incidentes de deploy">
      <header className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Incidentes de deploy{attention ? ` · ${attention} aberto${attention === 1 ? "" : "s"}` : ""}</h3>
        <p className="text-xs text-muted">Quando um deploy falha, a equipe acha a causa e corrige sozinha. O agente que fez o commit quebrado fica bloqueado até o deploy dar certo.</p>
      </header>
      {incidents.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted">Nenhum deploy falhou desde que o recurso foi ligado.</p>
      ) : (
        <ul className="divide-y divide-border">
          {incidents.map((i) => (
            <li key={i.id}>
              <button className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-surface" onClick={() => setOpen(open === i.id ? null : i.id)} aria-expanded={open === i.id}>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{i.application}</span>
                  <span className="block truncate text-xs text-muted">{i.commit ? `${i.commit} · ` : ""}{i.commitMessage ?? "commit desconhecido"}</span>
                  <span className="mt-1 block text-[11px] text-muted">
                    aberto {when(i.createdAt)} · tentativa {i.attempts}
                    {i.culprit ? ` · agente ${i.culprit.name}${i.culprit.locked ? " BLOQUEADO" : ""}` : ""}
                  </span>
                </span>
                <Pill meta={INCIDENT_STATUS[i.status] ?? INCIDENT_STATUS.OPEN} />
              </button>
              {open === i.id && (
                <div className="space-y-2 border-t border-border bg-background/40 px-4 py-3 text-xs">
                  {i.summary && <pre className="whitespace-pre-wrap break-words text-muted">{i.summary}</pre>}
                  {canWrite && i.status !== "RESOLVED" && (
                    <div className="flex flex-wrap gap-2">
                      {i.culprit?.locked && (
                        <Button size="sm" variant="secondary" disabled={act.isPending} onClick={() => act.mutate({ id: i.id, action: "unlock" }, { onSuccess: () => toast.success("Agente liberado."), onError: (e) => toast.error(e.message) })}>
                          Liberar {i.culprit.name}
                        </Button>
                      )}
                      <Button size="sm" variant="secondary" disabled={act.isPending} onClick={() => act.mutate({ id: i.id, action: "resolve" }, { onSuccess: () => toast.success("Incidente fechado."), onError: (e) => toast.error(e.message) })}>
                        Dar por resolvido
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const FIX_STATE: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: "Aguardando", color: STATUS.warning, icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  fixing: { label: "Manager corrigindo", color: SERIES.blue, icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
  sent: { label: "Enviado", color: STATUS.good, icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  dismissed: { label: "Descartado", color: "#8890a3", icon: <Ban className="h-3.5 w-3.5" /> },
};

const ACTION_COLOR: Record<HumanActionKind, string> = { merge: STATUS.critical, aprovacao: STATUS.warning, incidente: STATUS.critical, acao: STATUS.warning };
const SEVERITY_LABEL: Record<string, string> = { CRITICAL: "Crítica", HIGH: "Alta", MEDIUM: "Média", LOW: "Baixa" };

/** Fila de correção: erros que a equipe CLT viu. O Italo escolhe UM, manda corrigir e o ID Manager gerencia (Doctor/DevOps). */
function Correcoes({ canWrite, onOpenCenter, onGoto }: { canWrite: boolean; onOpenCenter: () => void; onGoto: (t: Tab) => void }) {
  const { data, isLoading, error } = useFixQueue();
  const { act } = useFixMutations();
  const [selected, setSelected] = useState<string | null>(null);
  const items = data?.items ?? [];
  const pick = items.find((i) => i.id === selected && i.state !== "fixing") ?? null;
  const pending = items.filter((i) => i.state === "pending").length;
  const actions = data?.actions ?? [];
  return (
    <div className="space-y-4">
    <section className="overflow-hidden rounded-xl border bg-surface-raised" style={{ borderColor: actions.length ? `${STATUS.critical}66` : undefined }} aria-label="Precisa de você">
      <header className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Precisa de você{actions.length ? ` · ${actions.length}` : ""}</h3>
        <p className="text-xs text-muted">Só você resolve. Em ordem de prioridade: merge pendente, autorizações, deploy que escalou e ações manuais.</p>
      </header>
      {actions.length === 0 ? (
        <p className="p-4 text-center text-sm text-muted">Nada esperando por você.</p>
      ) : (
        <ul className="divide-y divide-border">
          {actions.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="block text-[11px] font-semibold uppercase tracking-wide" style={{ color: ACTION_COLOR[a.kind] }}>{HUMAN_ACTION_LABEL[a.kind]}</span>
                <span className="block text-sm font-medium text-foreground">{a.title}</span>
                <span className="block whitespace-pre-wrap break-words text-xs text-muted">{a.detail}</span>
                <span className="block text-[11px] text-muted">desde {when(a.at)}</span>
              </span>
              <span className="flex shrink-0 gap-2">
                {a.kind === "merge" && a.url && <a href={a.url} target="_blank" rel="noreferrer" className="rounded-lg bg-accent/20 px-3 py-1.5 text-xs font-medium text-foreground ring-1 ring-accent/50 hover:bg-accent/30">Abrir PR</a>}
                {a.kind === "aprovacao" && <Button size="sm" variant="secondary" onClick={onOpenCenter}>Abrir na Central</Button>}
                {a.kind === "incidente" && <Button size="sm" variant="secondary" onClick={() => onGoto("operacao")}>Ver incidente</Button>}
                {a.kind === "acao" && a.itemId && canWrite && (
                  <Button size="sm" variant="secondary" disabled={act.isPending} onClick={() => act.mutate({ id: a.itemId!, action: "dismiss" }, { onSuccess: () => toast.success("Marcado como feito."), onError: (e) => toast.error(e.message) })}>Já fiz</Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
    <section className="overflow-hidden rounded-xl border bg-surface-raised" style={{ borderColor: pending ? `${STATUS.warning}66` : undefined }} aria-label="Fila de correção">
      <header className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">O que a equipe viu e pode melhorar{pending ? ` · ${pending} aguardando` : ""}</h3>
        <p className="text-xs text-muted">Erros dos logs e achados de qualquer agente (segurança, desempenho, qualidade, documentação…). Escolha um e mande corrigir. É um de cada vez: o ID Manager delega ao Doctor ou ao DevOps e gerencia. A correção de código chega em PR para você revisar.</p>
      </header>
      {isLoading && <p className="p-6 text-center text-sm text-muted">Carregando…</p>}
      {error && <p className="p-4 text-sm" style={{ color: STATUS.critical }}>Não consegui carregar a fila: {error instanceof Error ? error.message : "erro desconhecido"}.</p>}
      {data && items.length === 0 && <p className="p-6 text-center text-sm text-muted">Nada registrado ainda: erros dos últimos 7 dias e achados dos agentes aparecem aqui.</p>}
      {items.length > 0 && (
        <ul className="divide-y divide-border" role="radiogroup" aria-label="Erros">
          {items.map((e) => {
            const locked = e.state === "fixing";
            const on = pick?.id === e.id;
            return (
              <li key={e.id}>
                <label className={cn("flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-surface", locked && "cursor-default opacity-90", on && "bg-accent/10")}>
                  <input type="radio" name="fix" className="mt-1" checked={on} disabled={locked || !canWrite} onChange={() => setSelected(e.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="block text-sm font-medium text-foreground">{e.kind === "achado" ? e.title : `${e.project ? `${e.project} / ` : ""}${e.application ?? "sistema"}`}</span>
                      <Pill meta={FIX_STATE[e.state]} />
                    </span>
                    {e.kind === "erro" && <span className="block truncate font-mono text-[11px] text-muted">{e.title}</span>}
                    <span className="block text-[11px] text-muted">
                      {e.kind === "achado" ? `${e.severity ? SEVERITY_LABEL[e.severity] ?? e.severity : ""} · ${e.category ?? "outro"}${e.application ? ` · ${e.application}` : ""} · por ${e.reportedBy}` : `erro de log · ${e.count}×`} · {when(e.lastSeenAt)}
                    </span>
                  </span>
                </label>
                {on && <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words border-t border-border bg-background/40 px-4 py-3 font-mono text-[11px] text-foreground/90">{e.detail}</pre>}
              </li>
            );
          })}
        </ul>
      )}
      {canWrite && items.length > 0 && (
        <footer className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          <Button size="sm" disabled={!pick || data?.busy || act.isPending} onClick={() => pick && act.mutate({ id: pick.id, action: "fix" }, { onSuccess: () => { toast.success("Enviado ao ID Manager."); setSelected(null); }, onError: (e) => toast.error(e.message) })}>
            <Send className="mr-1 h-3.5 w-3.5" /> Mandar corrigir
          </Button>
          <Button size="sm" variant="secondary" disabled={!pick || act.isPending} onClick={() => pick && act.mutate({ id: pick.id, action: "dismiss" }, { onSuccess: () => { toast.success("Descartado."); setSelected(null); }, onError: (e) => toast.error(e.message) })}>
            Descartar
          </Button>
          <span className="text-xs text-muted">{data?.busy ? "O Manager está corrigindo um erro: espere terminar para mandar outro." : pick ? "Pronto para enviar." : "Selecione um erro."}</span>
        </footer>
      )}
    </section>
    </div>
  );
}

function Operacao({ d, canWrite }: { d: CltDashboardView; canWrite: boolean }) {
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
      <Incidentes incidents={op.incidents} canWrite={canWrite} />
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
    ? [{ id: "correcoes", label: "Correções" }, { id: "operacao", label: "Operação" }, { id: "resumo", label: "Resumo" }, { id: "equipe", label: "Equipe" }, { id: "tarefas", label: "Tarefas" }, { id: "rotinas", label: "Rotinas" }, { id: "conversar", label: "Conversar" }]
    : [{ id: "resumo", label: "Resumo" }, { id: "tarefas", label: "Tarefas" }, { id: "rotinas", label: "Rotinas" }, { id: "conversar", label: "Conversar" }];
  const [tab, setTab] = useState<Tab | null>(null);
  const current: Tab = tab && tabs.some((t) => t.id === tab) ? tab : tabs[0].id;
  const a = d?.agent;

  // Esc fecha o painel (menos quando o foco está num campo de texto)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
        {d && current === "correcoes" && <Correcoes canWrite={canWrite} onOpenCenter={onOpenCenter} onGoto={setTab} />}
        {d && current === "operacao" && <Operacao d={d} canWrite={canWrite} />}
        {d && current === "resumo" && <Resumo d={d} />}
        {d && current === "equipe" && <Equipe d={d} onSelect={onSelectAgent} />}
        {d && current === "tarefas" && <TaskList tasks={d.recentTasks} />}
        {d && current === "rotinas" && <RoutineList routines={d.routines} />}
        {d && current === "conversar" && <Conversar d={d} canWrite={canWrite} />}
      </div>
    </aside>
  );
}
