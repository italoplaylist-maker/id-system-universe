"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, PauseCircle, Play, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { fmtTokens } from "@/lib/claude-usage";
import { COMMERCIAL_LABEL, LEAD_SEGMENTS, LEAD_STAGES, MAX_RADIUS_KM, SEGMENT_LABEL, priorityLabel, stageLabel } from "@/lib/commercial-team";
import { describeSchedule, ROUTINE_GATES } from "@/lib/clt-routines";
import { useCommercial, useCommercialMutations, useOrchestratorTasks, useRoutineMutations, useRoutines, type CommercialView } from "@/hooks/use-orchestrator";
import { Meter, STATUS, StatTile } from "./charts";

/** Cor-tema da equipe comercial (a técnica usa vermelho/azul): âmbar e verde-água, em todo lugar onde a equipe aparece. */
const AMBER = "#f59e0b";
const TEAL = "#14b8a6";

type Tab = "geral" | "agentes" | "leads" | "abordagens" | "historico" | "config";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "geral", label: "Visão geral" },
  { id: "agentes", label: "Agentes" },
  { id: "leads", label: "Leads" },
  { id: "abordagens", label: "Abordagens" },
  { id: "historico", label: "Histórico" },
  { id: "config", label: "Configurações" },
];

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

const STATE: Record<string, { label: string; color: string }> = {
  AVAILABLE: { label: "Disponível", color: STATUS.good },
  DONE: { label: "Concluiu", color: STATUS.good },
  RECEIVING: { label: "Comando recebido", color: TEAL },
  RUNNING: { label: "Executando", color: TEAL },
  WAITING: { label: "Aguarda aprovação", color: STATUS.warning },
  ERROR: { label: "Com erro", color: STATUS.critical },
  PAUSED: { label: "Pausado", color: "#8890a3" },
};

function Geral({ d, canWrite }: { d: CommercialView; canWrite: boolean }) {
  const { startCycle } = useCommercialMutations();
  const i = d.indicators;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Leads encontrados" value={i.leadsFound} hint={`${i.researched} empresas pesquisadas`} />
        <StatTile label="Leads qualificados" value={i.qualified} hint={`${i.open} oportunidades abertas`} />
        <StatTile label="Abordagens pendentes" value={i.pendingApproaches} hint={i.pendingApproaches ? "aguardam sua decisão" : "nada pendente"} />
        <StatTile label="Clientes convertidos" value={i.converted} hint={i.conversionRate === null ? "taxa de conversão: —" : `taxa de conversão: ${i.conversionRate}%`} />
        <StatTile label="Parados" value={i.stale} hint="sem atualização há mais de 7 dias" />
        <StatTile label="Perdidos" value={i.lost} />
        <StatTile label="Tokens no mês" value={fmtTokens(i.tokensMonth)} hint={`hoje: ${fmtTokens(i.tokensDay)}`} />
        <StatTile label="Custo operacional (mês)" value={i.costMonth === null ? "—" : `R$ ${i.costMonth.toFixed(2)}`} hint={i.costMonth === null ? "defina o preço por milhão de tokens em Configurações" : `${fmtTokens(i.tokensMonth)} tokens`} />
      </div>
      <section className="rounded-xl border border-border bg-surface-raised p-4" aria-label="Controle de execução">
        <h3 className="text-sm font-semibold text-foreground">Controle de execução</h3>
        <p className="mb-3 text-xs text-muted">Executa um ciclo coordenado: Garimpeiro → Analista → CRM → Vendedor. Cada passo só começa quando o anterior termina bem; se um falhar ou faltar orçamento, o ciclo para (nada de loop). As rotinas agendadas ficam em Configurações.</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={!canWrite || d.cycle.running || startCycle.isPending || !d.exists} onClick={() => startCycle.mutate(undefined, { onSuccess: () => toast.success("Ciclo comercial iniciado."), onError: (e) => toast.error(e.message) })}>
            {d.cycle.running || startCycle.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />} Executar ciclo agora
          </Button>
          <span className="text-xs text-muted">{d.cycle.running ? `Em andamento: passo ${(d.cycle.step ?? 0) + 1}/4${d.cycle.label ? ` (${d.cycle.label})` : ""}` : "Nenhum ciclo em andamento."}</span>
        </div>
      </section>
    </div>
  );
}

function Agentes({ d, onSelectAgent }: { d: CommercialView; onSelectAgent: (id: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {d.team.agents.map((a) => {
        const st = STATE[a.state] ?? STATE.AVAILABLE;
        return (
          <button key={a.id} onClick={() => onSelectAgent(a.id)} className="rounded-xl border bg-surface-raised p-4 text-left hover:bg-surface" style={{ borderColor: `${TEAL}55` }}>
            <div className="flex items-start justify-between gap-2">
              <span>
                <span className="block text-sm font-semibold text-foreground">{a.name}</span>
                <span className="block text-xs text-muted">{a.roleTitle}</span>
              </span>
              <span className="rounded-full px-2.5 py-1 text-xs font-medium" style={{ color: st.color, background: `${st.color}1f` }}>{st.label}</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-muted">
              <span><strong className="block text-sm text-foreground">{a.tasks.running + a.tasks.pending}</strong>em andamento/fila</span>
              <span><strong className="block text-sm text-foreground">{a.tasks.completed}</strong>concluídas</span>
              <span><strong className="block text-sm text-foreground">{a.tasks.failed}</strong>falhas</span>
            </div>
            <div className="mt-3">
              <Meter percent={a.usage.dayPercent} label={`Tokens hoje de ${a.name}`} />
              <span className="text-[11px] text-muted">{fmtTokens(a.usage.usedDay)} hoje · {fmtTokens(a.usage.usedMonth)} no mês</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Leads({ d, canWrite }: { d: CommercialView; canWrite: boolean }) {
  const { setLead } = useCommercialMutations();
  const [stage, setStage] = useState<string>("");
  const [open, setOpen] = useState<string | null>(null);
  const list = d.leads.filter((l) => (stage ? l.stage === stage && !l.discarded : true));
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface-raised" aria-label="Leads">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Leads ({list.length})</h3>
        <select aria-label="Filtrar por etapa" value={stage} onChange={(e) => setStage(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1 text-xs">
          <option value="">Todas as etapas</option>
          {LEAD_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </header>
      {list.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted">Nenhum lead ainda. Crie a equipe, confira as Configurações e execute um ciclo.</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((l) => (
            <li key={l.id}>
              <button className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-surface" onClick={() => setOpen(open === l.id ? null : l.id)} aria-expanded={open === l.id}>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{l.name}{l.discarded ? " (descartado)" : ""}</span>
                  <span className="block truncate text-xs text-muted">{SEGMENT_LABEL[l.segment] ?? l.segment}{l.city ? ` · ${l.city}` : ""}{l.distanceKm !== null ? ` · ~${Math.round(l.distanceKm)} km` : ""}</span>
                  <span className="block text-[11px] text-muted">{stageLabel(l.stage)} · {priorityLabel(l.priority)}{l.stale ? " · PARADO" : ""}</span>
                </span>
                <span className="shrink-0 text-right text-[11px] text-muted">por {l.foundBy}<br />{when(l.foundAt)}</span>
              </button>
              {open === l.id && (
                <div className="space-y-2 border-t border-border bg-background/40 px-4 py-3 text-xs">
                  <p><strong>Origem:</strong> {l.source}</p>
                  {l.phone && <p><strong>Telefone:</strong> {l.phone}</p>}
                  {l.website && <p><strong>Site:</strong> {l.website}</p>}
                  {l.techNeed && <p><strong>Necessidade provável (hipótese):</strong> {l.techNeed}</p>}
                  {l.priorityReason && <p><strong>Por que {priorityLabel(l.priority)}:</strong> {l.priorityReason}</p>}
                  {l.productFit && <p><strong>Produto:</strong> {l.productFit}</p>}
                  {l.painPoints && <p><strong>Dores:</strong> {l.painPoints}</p>}
                  {l.missingInfo && <p><strong>Faltam:</strong> {l.missingInfo}</p>}
                  {l.conversionNote && <p className="italic text-muted">{l.conversionNote}</p>}
                  {l.discardReason && <p><strong>Descarte:</strong> {l.discardReason}</p>}
                  {canWrite && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <select aria-label="Mover de etapa" value={l.stage} onChange={(e) => setLead.mutate({ id: l.id, stage: e.target.value }, { onSuccess: () => toast.success("Etapa atualizada."), onError: (err) => toast.error(err.message) })} className="rounded-md border border-border bg-background px-2 py-1">
                        {LEAD_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                      <Button size="sm" variant="secondary" disabled={setLead.isPending} onClick={() => setLead.mutate({ id: l.id, discarded: !l.discarded }, { onSuccess: () => toast.success(l.discarded ? "Lead reaberto." : "Lead descartado."), onError: (err) => toast.error(err.message) })}>
                        {l.discarded ? "Reabrir" : "Descartar"}
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

function Abordagens({ d, canWrite }: { d: CommercialView; canWrite: boolean }) {
  const { decide } = useCommercialMutations();
  const act = (id: string, decision: "approve" | "reject" | "sent") => decide.mutate({ id, decision }, { onSuccess: () => toast.success(decision === "reject" ? "Rascunho rejeitado." : decision === "sent" ? "Registrado como enviado por você." : "Rascunho aprovado."), onError: (e) => toast.error(e.message) });
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface-raised" aria-label="Abordagens pendentes">
      <header className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Abordagens pendentes ({d.pending.length})</h3>
        <p className="text-xs text-muted">O Universe NÃO envia nada. Aprove o texto, envie você mesmo (WhatsApp, e-mail…) e marque «Enviei»: só então o lead vira Primeiro contato.</p>
      </header>
      {d.pending.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted">Nenhum rascunho aguardando decisão.</p>
      ) : (
        <ul className="divide-y divide-border">
          {d.pending.map((p) => (
            <li key={p.id} className="space-y-2 px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium text-foreground">{p.leadName} <span className="text-xs font-normal text-muted">· {p.channel ?? "canal livre"}</span></span>
                <span className="text-[11px] text-muted">{p.agentName} · {when(p.createdAt)}</span>
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/50 p-2 font-sans text-xs text-foreground/90">{p.content}</pre>
              {canWrite && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" disabled={decide.isPending} onClick={() => { void navigator.clipboard?.writeText(p.content); toast.success("Texto copiado."); }}>Copiar texto</Button>
                  <Button size="sm" disabled={decide.isPending} onClick={() => act(p.id, "sent")}>Enviei</Button>
                  <Button size="sm" variant="secondary" disabled={decide.isPending} onClick={() => act(p.id, "reject")}>Rejeitar</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const TASK_LABEL: Record<string, { label: string; color: string }> = {
  COMPLETED: { label: "Concluída", color: STATUS.good }, FAILED: { label: "Falhou", color: STATUS.critical }, INTERRUPTED: { label: "Interrompida", color: STATUS.critical },
  CANCELLED: { label: "Cancelada", color: "#8890a3" }, RUNNING: { label: "Executando", color: TEAL }, STARTING: { label: "Iniciando", color: TEAL }, QUEUED: { label: "Na fila", color: STATUS.warning }, WAITING_APPROVAL: { label: "Aguarda aprovação", color: STATUS.warning },
};

function Historico({ d }: { d: CommercialView }) {
  const ids = new Set(d.team.agents.map((a) => a.id));
  const active = useOrchestratorTasks("active", null);
  const history = useOrchestratorTasks("history", null);
  const rows = [...(active.data ?? []), ...(history.data ?? [])].filter((t) => ids.has(t.agentId)).slice(0, 40);
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface-raised" aria-label="Histórico de execuções">
      <header className="border-b border-border px-4 py-3"><h3 className="text-sm font-semibold text-foreground">Atividades e histórico</h3></header>
      {rows.length === 0 ? <p className="p-6 text-center text-sm text-muted">Nenhuma execução ainda.</p> : (
        <ul className="divide-y divide-border">
          {rows.map((t) => {
            const st = TASK_LABEL[t.status] ?? TASK_LABEL.QUEUED;
            return (
              <li key={t.id} className="px-4 py-3 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-foreground">{t.agentName}</span>
                  <span className="rounded-full px-2 py-0.5" style={{ color: st.color, background: `${st.color}1f` }}>{st.label}</span>
                </div>
                <p className="truncate text-muted">{t.prompt.replace(/\s+/g, " ").slice(0, 160)}</p>
                {(t.result || t.error) && <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-foreground/80">{(t.error ?? t.result ?? "").slice(0, 400)}</p>}
                <p className="text-[11px] text-muted">{when(t.createdAt)}</p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Config({ d, canWrite }: { d: CommercialView; canWrite: boolean }) {
  const { saveSettings } = useCommercialMutations();
  const routines = useRoutines();
  const { update } = useRoutineMutations();
  const s = d.settings;
  const [city, setCity] = useState(s.baseCity);
  const [radius, setRadius] = useState(String(s.radiusKm));
  const [max, setMax] = useState(String(s.maxNewLeadsPerRun));
  const [price, setPrice] = useState(s.costPerMillionTokens === null ? "" : String(s.costPerMillionTokens));
  const [segments, setSegments] = useState<string[]>(s.segments);
  const mine = (routines.data ?? []).filter((r) => d.team.agents.some((a) => a.id === r.agentId));
  const save = () => {
    const radiusKm = Number(radius);
    const maxNewLeadsPerRun = Number(max);
    if (!Number.isInteger(radiusKm) || radiusKm < 1 || radiusKm > MAX_RADIUS_KM) return toast.error(`O raio deve ser de 1 a ${MAX_RADIUS_KM} km.`);
    if (segments.length === 0) return toast.error("Escolha ao menos um segmento.");
    saveSettings.mutate({ baseCity: city.trim(), radiusKm, segments, maxNewLeadsPerRun, costPerMillionTokens: price.trim() === "" ? null : Number(price.replace(",", ".")) }, { onSuccess: () => toast.success("Configuração salva."), onError: (e) => toast.error(e.message) });
  };
  const field = "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm";
  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl border border-border bg-surface-raised p-4" aria-label="Prospecção">
        <h3 className="text-sm font-semibold text-foreground">Prospecção</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-muted">Cidade-base<input className={field} value={city} onChange={(e) => setCity(e.target.value)} disabled={!canWrite} /></label>
          <label className="text-xs text-muted">Raio (km)<input className={field} inputMode="numeric" value={radius} onChange={(e) => setRadius(e.target.value)} disabled={!canWrite} /></label>
          <label className="text-xs text-muted">Máx. de leads novos por execução<input className={field} inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} disabled={!canWrite} /></label>
          <label className="text-xs text-muted">Preço por milhão de tokens (R$) — opcional<input className={field} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} disabled={!canWrite} placeholder="vazio = mostrar só tokens" /></label>
        </div>
        <fieldset>
          <legend className="mb-1 text-xs text-muted">Segmentos</legend>
          <div className="flex flex-wrap gap-2">
            {LEAD_SEGMENTS.map((seg) => {
              const on = segments.includes(seg);
              return (
                <label key={seg} className={cn("cursor-pointer rounded-full border px-3 py-1 text-xs", on ? "border-accent/60 bg-accent/15 text-foreground" : "border-border text-muted")}>
                  <input type="checkbox" className="sr-only" checked={on} disabled={!canWrite} onChange={() => setSegments(on ? segments.filter((x) => x !== seg) : [...segments, seg])} />
                  {SEGMENT_LABEL[seg]}
                </label>
              );
            })}
          </div>
        </fieldset>
        {canWrite && <Button size="sm" disabled={saveSettings.isPending} onClick={save}>Salvar configuração</Button>}
      </section>
      <section className="overflow-hidden rounded-xl border border-border bg-surface-raised" aria-label="Rotinas agendadas">
        <header className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">Rotinas e frequência</h3>
          <p className="text-xs text-muted">Nascem desligadas. Ligue as que quiser; os gatilhos pulam a execução quando não há trabalho (não gasta token à toa).</p>
        </header>
        {mine.length === 0 ? <p className="p-4 text-sm text-muted">Sem rotinas ainda.</p> : (
          <ul className="divide-y divide-border">
            {mine.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs">
                <span>
                  <strong className="block text-sm text-foreground">{r.name}</strong>
                  <span className="text-muted">{r.agentName} · {describeSchedule(r)} · {ROUTINE_GATES.find((g) => g.id === r.gate)?.label ?? r.gate}</span>
                  <span className="block text-[11px] text-muted">última: {when(r.lastRunAt)} {r.lastOutcome ? `— ${r.lastOutcome}` : ""}</span>
                </span>
                {canWrite && (
                  <Button size="sm" variant={r.enabled ? "primary" : "secondary"} disabled={update.isPending} onClick={() => update.mutate({ id: r.id, enabled: !r.enabled }, { onError: (e) => toast.error(e.message) })}>
                    {r.enabled ? "Ligada" : "Desligada"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Painel da equipe COMERCIAL & MARKETING: abre ao clicar no núcleo da segunda ilha. Tudo vem do banco (funil, tarefas, tokens);
 * a equipe prepara, o Italo decide — nenhuma mensagem sai sem aprovação humana.
 */
export function CommercialPanel({ canWrite, onClose, onSelectAgent, onOpenCenter }: { canWrite: boolean; onClose: () => void; onSelectAgent: (id: string) => void; onOpenCenter: () => void }) {
  const { data: d, isLoading, error } = useCommercial(true);
  const { createTeam } = useCommercialMutations();
  const [tab, setTab] = useState<Tab>("geral");
  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-full max-w-3xl flex-col border-l bg-surface-raised/95 shadow-2xl backdrop-blur" style={{ borderColor: `${TEAL}66` }} aria-label="Equipe Comercial e Marketing">
      <header className="border-b border-border px-5 pt-4" style={{ background: `linear-gradient(135deg, ${TEAL}22, transparent 60%)` }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: AMBER }}>{COMMERCIAL_LABEL}</p>
            <h2 className="text-lg font-semibold text-foreground">Equipe comercial</h2>
            <p className="text-xs text-muted">Encontra empresas, qualifica oportunidades e prepara a venda dos produtos da ID System. Nada é enviado sem a sua aprovação.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={onOpenCenter}>Central</Button>
            <button onClick={onClose} aria-label="Fechar painel" className="rounded-md p-1 text-muted hover:bg-surface hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div role="tablist" aria-label="Seções" className="mt-3 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm", tab === t.id ? "font-medium text-foreground ring-1" : "text-muted hover:bg-surface hover:text-foreground")} style={tab === t.id ? { background: `${TEAL}26`, boxShadow: `inset 0 0 0 1px ${TEAL}88` } : undefined}>
              {t.label}{t.id === "abordagens" && d && d.pending.length > 0 ? ` (${d.pending.length})` : ""}
            </button>
          ))}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
        {isLoading && <p className="text-sm text-muted">Carregando…</p>}
        {error && <p className="flex items-center gap-1 text-sm" style={{ color: STATUS.critical }}><AlertCircle className="h-4 w-4" /> Não consegui carregar: {error instanceof Error ? error.message : "erro desconhecido"}.</p>}
        {d && !d.exists && (
          <div className="space-y-3 rounded-xl border border-border bg-surface-raised p-5 text-sm">
            <p className="font-medium text-foreground">A equipe Comercial & Marketing ainda não foi criada.</p>
            <p className="text-muted">Cria os 4 funcionários (Garimpeiro, Analista Comercial, CRM e Vendedor) na ilha comercial. As rotinas nascem desligadas.</p>
            {canWrite ? (
              <Button size="sm" disabled={createTeam.isPending} onClick={() => createTeam.mutate(undefined, { onSuccess: (r) => toast.success(`Equipe criada: ${r.created.length} funcionário(s).`), onError: (e) => toast.error(e.message) })}>
                {createTeam.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Criar equipe Comercial & Marketing"}
              </Button>
            ) : <p className="flex items-center gap-1 text-muted"><PauseCircle className="h-4 w-4" /> Peça a um administrador para criá-la.</p>}
          </div>
        )}
        {d && d.exists && tab === "geral" && <Geral d={d} canWrite={canWrite} />}
        {d && d.exists && tab === "agentes" && <Agentes d={d} onSelectAgent={onSelectAgent} />}
        {d && d.exists && tab === "leads" && <Leads d={d} canWrite={canWrite} />}
        {d && d.exists && tab === "abordagens" && <Abordagens d={d} canWrite={canWrite} />}
        {d && d.exists && tab === "historico" && <Historico d={d} />}
        {d && tab === "config" && <Config d={d} canWrite={canWrite} />}
        {d && d.exists && <p className="mt-4 flex items-center gap-1 text-[11px] text-muted"><CheckCircle2 className="h-3 w-3" /> Indicadores e listas vêm do banco em tempo real.</p>}
      </div>
    </aside>
  );
}
