"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useGithubRepos, useOrchestratorMutations, useRefreshGithubRepos } from "@/hooks/use-orchestrator";

/** Conectar (ou trocar) o repositório GitHub do agente, direto na central — sem precisar mexer em recursos do projeto. */
export function RepoConnect({ agentId, canWrite, current, onDone }: { agentId: string; canWrite: boolean; current?: string | null; onDone?: () => void }) {
  const { data, isLoading } = useGithubRepos(canWrite);
  const refresh = useRefreshGithubRepos();
  const { updateAgent } = useOrchestratorMutations();
  const [repoId, setRepoId] = useState("");
  const [branch, setBranch] = useState("");

  if (!canWrite) return <p className="text-[11px] text-muted">Peça a um administrador para conectar um repositório GitHub a este agente.</p>;
  if (isLoading) return <p className="flex items-center gap-1.5 text-[11px] text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />Buscando repositórios…</p>;

  const repos = data?.repositories ?? [];
  if (repos.length === 0) {
    return (
      <div className="space-y-1.5 text-[11px] text-muted">
        <p>{data?.installations ? "O GitHub App está instalado, mas ainda não liberou nenhum repositório." : "O GitHub ainda não está conectado ao Universe."}</p>
        <div className="flex flex-wrap gap-2">
          <Link href="/settings/integrations" className="rounded border border-border px-2 py-1 text-foreground hover:bg-surface">Conectar o GitHub</Link>
          <button className="flex items-center gap-1 rounded border border-border px-2 py-1 text-foreground hover:bg-surface" onClick={() => refresh.mutate(undefined, { onError: (e) => toast.error(e.message) })} disabled={refresh.isPending}>
            <RefreshCw className={refresh.isPending ? "h-3 w-3 animate-spin" : "h-3 w-3"} />Atualizar lista
          </button>
        </div>
      </div>
    );
  }

  const selected = repos.find((r) => r.id === repoId);
  return (
    <div className="space-y-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Repositório do GitHub" className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-xs text-foreground" value={repoId} onChange={(e) => setRepoId(e.target.value)}>
          <option value="">Escolha o repositório…</option>
          {repos.map((r) => (
            <option key={r.id} value={r.id}>{r.fullName}{r.isPrivate ? " 🔒" : ""}</option>
          ))}
        </select>
        <input aria-label="Branch base" className="w-28 rounded border border-border bg-surface px-2 py-1 text-xs text-foreground" placeholder={selected?.defaultBranch ?? "branch base"} value={branch} onChange={(e) => setBranch(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="rounded bg-accent px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
          disabled={!repoId || updateAgent.isPending}
          onClick={() =>
            updateAgent.mutate(
              { id: agentId, githubRepositoryId: repoId, githubBranch: branch.trim() || null },
              {
                onSuccess: (d) => {
                  const p = d.agent.prepare;
                  if (p && !p.ok) toast.error(`Conectei, mas não consegui baixar: ${p.message}`);
                  else toast.success(`Repositório conectado.${p?.message && p.message !== "Pronto." ? ` ${p.message}` : ""}`);
                  setRepoId("");
                  setBranch("");
                  onDone?.();
                },
                onError: (e) => toast.error(e.message),
              },
            )
          }
        >
          {updateAgent.isPending ? "Conectando e baixando…" : current ? "Trocar repositório" : "Conectar repositório"}
        </button>
        <button className="flex items-center gap-1 text-muted hover:text-foreground" onClick={() => refresh.mutate(undefined, { onError: (e) => toast.error(e.message) })} disabled={refresh.isPending}>
          <RefreshCw className={refresh.isPending ? "h-3 w-3 animate-spin" : "h-3 w-3"} />Atualizar lista
        </button>
        {current && <button className="text-muted hover:text-foreground" onClick={() => onDone?.()}>Cancelar</button>}
      </div>
      <p className="text-muted">É daqui que o agente baixa o código e abre PR/merge. {repos.length} repositório(s) liberado(s) pelo GitHub App.</p>
    </div>
  );
}
