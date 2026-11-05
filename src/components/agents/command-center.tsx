"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Ban, CheckCircle2, Clock, Loader2, PauseCircle, Plus, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ToolsPanel } from "./tools-panel";
import { cn } from "@/lib/cn";
import {
  useOrchestratorMutations,
  useOrchestratorSettings,
  useOrchestratorStatus,
  useOrchestratorStream,
  useOrchestratorTasks,
  useRoomAgents,
  useTaskDetail,
  type RoomAgentView,
  type TaskView,
} from "@/hooks/use-orchestrator";

const ROOM_LABEL: Record<RoomAgentView["state"], { label: string; cls: string }> = {
  AVAILABLE: { label: "Disponível", cls: "text-status-running" },
  RECEIVING: { label: "Comando recebido", cls: "text-status-deploying" },
  RUNNING: { label: "Executando", cls: "text-status-deploying" },
  WAITING: { label: "Aguarda sua aprovação", cls: "text-status-warning" },
  DONE: { label: "Concluído", cls: "text-status-running" },
  ERROR: { label: "Erro", cls: "text-status-error" },
  PAUSED: { label: "Pausado", cls: "text-muted" },
};

const TASK_LABEL: Record<TaskView["status"], string> = {
  QUEUED: "NA FILA",
  STARTING: "INICIANDO",
  RUNNING: "EXECUTANDO",
  WAITING_APPROVAL: "AGUARDANDO APROVAÇÃO",
  COMPLETED: "CONCLUÍDA",
  FAILED: "FALHOU",
  CANCELLED: "CANCELADA",
  INTERRUPTED: "INTERROMPIDA",
};

const taskTone = (s: TaskView["status"]) =>
  s === "COMPLETED" ? "text-status-running" : s === "FAILED" || s === "INTERRUPTED" ? "text-status-error" : s === "CANCELLED" ? "text-muted" : s === "WAITING_APPROVAL" ? "text-status-warning" : "text-status-deploying";

const shortId = (id: string) => id.slice(-6).toUpperCase();
const hms = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const isFinal = (s: TaskView["status"]) => s === "COMPLETED" || s === "FAILED" || s === "CANCELLED" || s === "INTERRUPTED";
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

function TaskDetail({ taskId, canWrite, onBack }: { taskId: string; canWrite: boolean; onBack: () => void }) {
  const { data } = useTaskDetail(taskId);
  const { cancel, decide } = useOrchestratorMutations();
  if (!data) return <p className="p-4 text-xs text-muted">Carregando…</p>;
  const { task, events, approval } = data;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <button className="text-xs text-muted hover:text-foreground" onClick={onBack}>← Voltar</button>
        <span className={cn("text-xs font-semibold", taskTone(task.status))}>Execução #{shortId(task.id)} · {TASK_LABEL[task.status]}</span>
      </div>
      <div className="space-y-2 overflow-y-auto p-4 text-xs">
        <p className="whitespace-pre-wrap break-words rounded-md border border-border bg-surface p-2 text-foreground">{task.prompt}</p>
        {canWrite && approval && (
          <div className="space-y-2 rounded-md border border-status-warning/40 bg-status-warning/10 p-3" role="alert">
            <p className="flex items-center gap-1.5 font-semibold text-status-warning"><AlertTriangle className="h-3.5 w-3.5" />O agente pede permissão para usar {approval.tool}</p>
            <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-background p-2">{approval.detail || "(sem detalhes)"}</pre>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" disabled={decide.isPending} onClick={() => decide.mutate({ id: approval.id, decision: "allow" }, { onError: (e) => toast.error(e.message) })}>Aprovar</Button>
              <Button size="sm" variant="danger" disabled={decide.isPending} onClick={() => decide.mutate({ id: approval.id, decision: "deny" }, { onError: (e) => toast.error(e.message) })}>Negar</Button>
            </div>
          </div>
        )}
        {canWrite && !isFinal(task.status) && (
          <Button size="sm" variant="secondary" disabled={cancel.isPending} onClick={() => cancel.mutate(task.id, { onError: (e) => toast.error(e.message) })}>
            <Ban className="h-3.5 w-3.5" />Cancelar execução
          </Button>
        )}
        {task.error && <p className="whitespace-pre-wrap break-words rounded-md border border-status-error/40 bg-status-error/10 p-2 text-status-error">{task.error}</p>}
        {task.result && <p className="whitespace-pre-wrap break-words rounded-md border border-border bg-surface p-2 text-foreground">{task.result}</p>}
        <p className="pt-1 font-semibold uppercase tracking-wide text-muted">Registro</p>
        <ul className="divide-y divide-border">
          {events.map((e) => (
            <li key={e.seq} className="py-1.5">
              <span className="tabular-nums text-muted">{hms(e.ts)}</span> <span className="font-medium text-foreground">{e.kind}{e.tool ? ` · ${e.tool}` : ""}</span>
              {e.text && <p className="whitespace-pre-wrap break-words text-muted">{e.text}</p>}
            </li>
          ))}
          {events.length === 0 && <li className="py-2 text-muted">Sem eventos ainda.</li>}
        </ul>
      </div>
    </div>
  );
}

/** Login do Claude (conta que paga o Claude Code) feito pelo Universe: abre a página oficial, o usuário cola o código aqui. */
function ClaudeLogin({ canWrite }: { canWrite: boolean }) {
  const { data: status } = useOrchestratorStatus(true);
  const { startLogin, submitLoginCode, logout } = useOrchestratorMutations();
  const [url, setUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  if (!status) return null;
  if (status.authenticated) {
    return (
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-1.5 text-[11px] text-muted">
        <span className="text-status-running">● Claude conectado{status.method === "assinatura" ? " (sua assinatura)" : status.method === "api" ? " (chave de API)" : ""}</span>
        {canWrite && status.method === "assinatura" && (
          <button className="hover:text-foreground" onClick={() => logout.mutate(undefined, { onError: (e) => toast.error(e.message) })}>Sair</button>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2 border-b border-status-warning/40 bg-status-warning/10 p-4 text-xs" role="status">
      <p className="font-semibold text-status-warning">O Claude ainda não está conectado neste servidor.</p>
      {!canWrite ? (
        <p className="text-muted">Peça a um administrador para entrar com a conta Claude.</p>
      ) : !url ? (
        <>
          <p className="text-muted">Entre com a mesma conta que paga o Claude Code. Não precisa de chave de API.</p>
          <Button size="sm" variant="primary" disabled={startLogin.isPending} onClick={() => startLogin.mutate(undefined, { onSuccess: (r) => { setUrl(r.url); window.open(r.url, "_blank", "noopener,noreferrer"); }, onError: (e) => toast.error(e.message) })}>
            Entrar com minha conta Claude
          </Button>
        </>
      ) : (
        <>
          <p className="text-muted">
            1) Uma aba do Claude foi aberta. Se não abriu,{" "}
            <a className="underline" href={url} target="_blank" rel="noopener noreferrer">clique aqui</a>. Entre e autorize.
            <br />2) Copie o código que a página mostrar e cole abaixo.
          </p>
          <div className="flex gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Cole o código aqui" autoComplete="off" spellCheck={false} className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 focus:border-accent focus:outline-none" />
            <Button size="sm" variant="primary" disabled={!code.trim() || submitLoginCode.isPending} onClick={() => submitLoginCode.mutate(code.trim(), { onSuccess: () => { setUrl(null); setCode(""); toast.success("Claude conectado."); }, onError: (e) => toast.error(e.message) })}>
              {submitLoginCode.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirmar"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function AgentForm({ initial, onDone }: { initial?: RoomAgentView; onDone: () => void }) {
  const { createAgent, updateAgent } = useOrchestratorMutations();
  const [f, setF] = useState({
    name: initial?.name ?? "", specialty: initial?.specialty ?? "", cwd: initial?.cwd ?? "", model: initial?.model ?? "", permissionMode: initial?.permissionMode ?? "default",
    effort: initial?.effort ?? "", allowed: (initial?.allowedTools ?? []).join("\n"), disallowed: (initial?.disallowedTools ?? []).join("\n"),
  });
  const field = "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs focus:border-accent focus:outline-none";
  const lines = (v: string) => v.split("\n").map((l) => l.trim()).filter(Boolean);
  return (
    <form
      className="space-y-2 border-b border-border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const body = { name: f.name, specialty: f.specialty || undefined, cwd: f.cwd, model: f.model || undefined, permissionMode: f.permissionMode, effort: f.effort || null, allowedTools: lines(f.allowed), disallowedTools: lines(f.disallowed) };
        if (initial) updateAgent.mutate({ id: initial.id, ...body, specialty: f.specialty, model: f.model }, { onSuccess: onDone, onError: (err) => toast.error(err.message) });
        else createAgent.mutate({ ...body, effort: f.effort || undefined }, { onSuccess: onDone, onError: (err) => toast.error(err.message) });
      }}
    >
      <p className="text-xs font-semibold text-foreground">{initial ? `Editar ${initial.name}` : "Novo funcionário"}</p>
      <input className={field} placeholder="Nome (ex.: Backend)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
      <input className={field} placeholder="Especialidade (opcional)" value={f.specialty} onChange={(e) => setF({ ...f, specialty: e.target.value })} />
      <input className={field} placeholder="Diretório no servidor, ex.: /srv/meu-projeto" value={f.cwd} onChange={(e) => setF({ ...f, cwd: e.target.value })} required />
      <div className="flex gap-2">
        <input className={field} placeholder="Modelo (vazio = padrão)" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} />
        <select className={field} value={f.effort} onChange={(e) => setF({ ...f, effort: e.target.value })} aria-label="Esforço">
          <option value="">Esforço: padrão</option><option value="low">baixo</option><option value="medium">médio</option><option value="high">alto</option><option value="xhigh">muito alto</option><option value="max">máximo</option>
        </select>
      </div>
      <select className={field} value={f.permissionMode} onChange={(e) => setF({ ...f, permissionMode: e.target.value })} aria-label="Permissões">
        <option value="default">Pedir aprovação para ações sensíveis</option>
        <option value="acceptEdits">Aceitar edições de arquivo (o resto pede aprovação)</option>
        <option value="plan">Somente planejar (sem executar)</option>
      </select>
      <textarea className={`${field} h-14 font-mono`} placeholder={"Liberadas sem aprovação, uma por linha:\nRead\nBash(git status:*)"} value={f.allowed} onChange={(e) => setF({ ...f, allowed: e.target.value })} spellCheck={false} />
      <textarea className={`${field} h-14 font-mono`} placeholder={"Bloqueadas, uma por linha:\nBash(rm:*)"} value={f.disallowed} onChange={(e) => setF({ ...f, disallowed: e.target.value })} spellCheck={false} />
      <div className="flex gap-2">
        <Button size="sm" type="submit" variant="primary" disabled={createAgent.isPending || updateAgent.isPending}>{initial ? "Salvar" : "Criar"}</Button>
        <Button size="sm" type="button" variant="secondary" onClick={onDone}>Cancelar</Button>
      </div>
    </form>
  );
}

/** Central de comandos: o Universe é o painel; o servidor executa o Claude em segundo plano. */
export function CommandCenter({ initialAgentId, onClose, canWrite }: { initialAgentId: string | null; onClose: () => void; canWrite: boolean }) {
  useOrchestratorStream(true);
  const { data: agents } = useRoomAgents(true);
  const { data: settings } = useOrchestratorSettings(true);
  const { submit, updateAgent, archiveAgent, setConcurrency } = useOrchestratorMutations();
  const [agentId, setAgentId] = useState<string | null>(initialAgentId);
  const [text, setText] = useState("");
  const [tab, setTab] = useState<"active" | "history">("active");
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [lastTaskId, setLastTaskId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  // Uma chave por COMANDO: se o envio falhar e o usuário clicar de novo, é a mesma chave (nunca duplica).
  const keyRef = useRef<{ text: string; key: string } | null>(null);

  useEffect(() => {
    if (initialAgentId) setAgentId(initialAgentId); // eslint-disable-line react-hooks/set-state-in-effect
  }, [initialAgentId]);
  const selected = useMemo(() => agents?.find((a) => a.id === agentId) ?? agents?.[0] ?? null, [agents, agentId]);
  const { data: tasks } = useOrchestratorTasks(tab, selected?.id ?? null, !!selected);
  const { data: last } = useTaskDetail(lastTaskId);

  const send = () => {
    if (!selected || !text.trim() || submit.isPending) return;
    if (!keyRef.current || keyRef.current.text !== text) keyRef.current = { text, key: newKey() };
    submit.mutate(
      { agentId: selected.id, prompt: text, idempotencyKey: keyRef.current.key },
      {
        onSuccess: ({ task }) => {
          setLastTaskId(task.id);
          setText("");
          keyRef.current = null;
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  const btn = "rounded px-2 py-1 text-xs font-medium";
  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-full max-w-md flex-col border-l border-border bg-surface-raised/95 shadow-2xl backdrop-blur" aria-label="Central de Agentes">
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-muted">Central de Agentes</p>
          <h2 className="truncate text-base font-semibold text-foreground">{selected ? selected.name : "Nenhum agente"}</h2>
          {selected && <p className="truncate text-xs text-muted">{selected.specialty ?? "—"} · {selected.cwd}</p>}
          {selected && <p className={cn("mt-1 text-xs font-medium", ROOM_LABEL[selected.state].cls)}>{ROOM_LABEL[selected.state].label}{selected.activity ? ` — ${selected.activity}` : ""}{selected.queued > 0 ? ` · ${selected.queued} na fila` : ""}</p>}
        </div>
        <button onClick={onClose} className="rounded p-1 text-muted hover:bg-surface hover:text-foreground" aria-label="Fechar"><X className="h-4 w-4" /></button>
      </div>

      <ClaudeLogin canWrite={canWrite} />

      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2">
        {agents?.map((a) => (
          <button key={a.id} onClick={() => { setAgentId(a.id); setOpenTask(null); }} className={cn(btn, "border", a.id === selected?.id ? "border-accent bg-accent/15 text-foreground" : "border-border text-muted hover:text-foreground")}>
            {a.name}
          </button>
        ))}
        <button onClick={() => setToolsOpen(true)} className={cn(btn, "ml-auto border border-border text-muted hover:text-foreground")}>Ferramentas</button>
        {canWrite && <button onClick={() => setCreating((v) => !v)} className={cn(btn, "border border-dashed border-border text-muted hover:text-foreground")}><Plus className="inline h-3 w-3" /> Novo</button>}
      </div>

      {creating && <AgentForm onDone={() => setCreating(false)} />}
      {editing && selected && <AgentForm initial={selected} onDone={() => setEditing(false)} />}

      {agents && agents.length === 0 && !creating && (
        <p className="p-4 text-sm text-muted">Nenhum funcionário ainda. {canWrite ? "Crie o primeiro em “Novo”: informe o diretório do projeto no servidor do Universe." : "Peça a um administrador para criar."}</p>
      )}

      {toolsOpen ? (
        <ToolsPanel canWrite={canWrite} onBack={() => setToolsOpen(false)} />
      ) : selected && openTask ? (
        <TaskDetail taskId={openTask} canWrite={canWrite} onBack={() => setOpenTask(null)} />
      ) : (
        selected && (
          <>
            {canWrite && (
              <div className="space-y-2 border-b border-border p-4">
                <label htmlFor="cc-command" className="text-xs font-medium text-foreground">Comando para {selected.name}</label>
                <textarea
                  id="cc-command"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
                  }}
                  rows={3}
                  maxLength={20000}
                  disabled={selected.paused}
                  placeholder={selected.paused ? "Agente pausado" : "Ex.: rode os testes e me diga o resultado"}
                  className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:opacity-60"
                />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted">Ctrl+Enter envia. O servidor executa sozinho — sem abrir o Claude.</p>
                  <Button size="sm" variant="primary" disabled={!text.trim() || submit.isPending || selected.paused} onClick={send}>
                    {submit.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Enviar
                  </Button>
                </div>
                {last && (
                  <button onClick={() => setOpenTask(last.task.id)} className="w-full rounded-md border border-border bg-surface p-2 text-left text-xs" aria-live="polite">
                    <span className="block font-semibold text-foreground">{last.task.queuePosition ? "COMANDO NA FILA" : "COMANDO RECEBIDO"}</span>
                    <span className="block text-muted">Agente: {last.task.agentName} · Execução #{shortId(last.task.id)}</span>
                    <span className={cn("block font-semibold", taskTone(last.task.status))}>
                      Status: {TASK_LABEL[last.task.status]}{last.task.queuePosition ? ` (posição ${last.task.queuePosition})` : ""}
                    </span>
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center gap-1 border-b border-border px-4 py-1.5 text-xs">
              <button className={cn(btn, tab === "active" ? "bg-surface text-foreground" : "text-muted")} onClick={() => setTab("active")}>Ativas e fila</button>
              <button className={cn(btn, tab === "history" ? "bg-surface text-foreground" : "text-muted")} onClick={() => setTab("history")}>Histórico</button>
            </div>
            <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto text-xs">
              {tasks?.map((t) => (
                <li key={t.id}>
                  <button className="flex w-full items-start gap-2 px-4 py-2.5 text-left hover:bg-surface" onClick={() => setOpenTask(t.id)}>
                    {t.status === "COMPLETED" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-running" /> : t.status === "FAILED" || t.status === "INTERRUPTED" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-error" /> : t.status === "CANCELLED" ? <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" /> : t.status === "QUEUED" ? <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-warning" /> : <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-status-deploying" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground">{t.prompt}</span>
                      <span className={cn("block font-semibold", taskTone(t.status))}>#{shortId(t.id)} · {TASK_LABEL[t.status]}{t.queuePosition ? ` · posição ${t.queuePosition}` : ""} <span className="font-normal text-muted">{hms(t.createdAt)}</span></span>
                    </span>
                  </button>
                </li>
              ))}
              {tasks && tasks.length === 0 && <li className="px-4 py-4 text-muted">{tab === "active" ? "Nada em andamento nem na fila." : "Sem histórico ainda."}</li>}
            </ul>
            {canWrite && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-xs">
                <label className="flex items-center gap-1.5 text-muted">
                  Simultâneas
                  <select className="rounded border border-border bg-surface px-1 py-0.5" value={settings?.maxConcurrent ?? 2} onChange={(e) => setConcurrency.mutate(Number(e.target.value))}>
                    {[1, 2, 3, 4, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <span className="flex gap-2">
                  <button className="flex items-center gap-1 text-muted hover:text-foreground" onClick={() => updateAgent.mutate({ id: selected.id, paused: !selected.paused })}>
                    <PauseCircle className="h-3.5 w-3.5" />{selected.paused ? "Retomar" : "Pausar"}
                  </button>
                  <button className="flex items-center gap-1 text-muted hover:text-foreground" onClick={() => setEditing((v) => !v)}>Editar</button>
                  <button className="flex items-center gap-1 text-muted hover:text-status-error" onClick={() => { if (window.confirm(`Remover ${selected.name}? O histórico é mantido.`)) archiveAgent.mutate(selected.id, { onError: (e) => toast.error(e.message) }); }}>
                    <Trash2 className="h-3.5 w-3.5" />Remover
                  </button>
                </span>
              </div>
            )}
          </>
        )
      )}
    </aside>
  );
}
