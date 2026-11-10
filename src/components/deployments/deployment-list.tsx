"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Copy } from "lucide-react";
import { toast } from "sonner";
import { useApplicationDeployments, useDeploymentLogs } from "@/hooks/use-applications";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { UniverseDeployment } from "@/types/domain";

const STATUS_CLASSES: Record<UniverseDeployment["status"], string> = {
  QUEUED: "text-status-unknown",
  RUNNING: "text-status-deploying",
  SUCCESS: "text-status-running",
  FAILED: "text-status-error",
  CANCELLED: "text-status-stopped",
};

const STATUS_LABEL: Record<UniverseDeployment["status"], string> = {
  QUEUED: "Na fila",
  RUNNING: "Implantando",
  SUCCESS: "Sucesso",
  FAILED: "Falhou",
  CANCELLED: "Cancelado",
};

const LEVEL_CLASSES: Record<string, string> = {
  INFO: "text-foreground/80",
  WARN: "text-status-warning",
  ERROR: "text-status-error",
};

function formatDuration(startedAt: string | null, finishedAt: string | null): string | null {
  if (!startedAt || !finishedAt) return null;
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 0) return null;
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** Log de um deploy: busca no histórico do Universe (ou ao vivo no Coolify enquanto roda), com busca e cópia. */
function DeploymentLog({ applicationId, deployment }: { applicationId: string; deployment: UniverseDeployment }) {
  const { data, isLoading, error } = useDeploymentLogs(applicationId, deployment.externalId);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const running = (data?.status ?? deployment.status) === "RUNNING" || (data?.status ?? deployment.status) === "QUEUED";

  const lines = useMemo(() => {
    const all = data?.lines ?? [];
    return search ? all.filter((l) => l.raw.toLowerCase().includes(search.toLowerCase())) : all;
  }, [data, search]);

  useEffect(() => {
    if (running && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines, running]);

  if (isLoading) return <p className="px-4 py-3 text-xs text-muted">Carregando log do deploy…</p>;
  if (error) return <p className="px-4 py-3 text-xs text-status-error">Não foi possível carregar o log: {error instanceof Error ? error.message : "erro desconhecido"}.</p>;
  if (!data || data.lines.length === 0) {
    return (
      <div className="space-y-1 px-4 py-3 text-xs" role="status">
        <p className="font-medium text-status-warning">Sem linhas de log para este deploy.</p>
        <p className="text-muted">{data?.note ?? (data?.source === "none" ? "O Coolify já não tem este deploy e nenhum log foi guardado antes." : "O deploy ainda não gerou saída.")}</p>
      </div>
    );
  }

  return (
    <div className="border-t border-border bg-background/60">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <Input placeholder="Buscar no log…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 max-w-[220px]" />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(data.lines.map((l) => l.raw).join("\n"));
            toast.success("Log copiado.");
          }}
        >
          <Copy className="h-3.5 w-3.5" />Copiar
        </Button>
        <span className="text-[11px] text-muted">
          {data.lines.length} linhas · {data.source === "history" ? "do histórico do Universe" : running ? "ao vivo, atualiza a cada 3 s" : "lido do Coolify"}
        </span>
      </div>
      <div ref={ref} className="max-h-96 overflow-auto px-4 pb-3 font-mono text-[11px] leading-relaxed">
        {lines.map((l, i) => (
          <div key={i} className={cn("whitespace-pre-wrap break-all", LEVEL_CLASSES[l.level])}>
            {l.timestamp && <span className="mr-2 text-muted">{new Date(l.timestamp).toLocaleTimeString("pt-BR")}</span>}
            {l.raw}
          </div>
        ))}
        {lines.length === 0 && <p className="text-muted">Nenhuma linha com “{search}”.</p>}
      </div>
    </div>
  );
}

export function DeploymentList({ applicationId }: { applicationId: string }) {
  const { data, isLoading } = useApplicationDeployments(applicationId);
  const deployments = data?.deployments ?? [];
  const [open, setOpen] = useState<string | null>(null);

  if (isLoading) return <p className="p-4 text-sm text-muted">Carregando deploys…</p>;
  if (deployments.length === 0) return <p className="p-4 text-sm text-muted">Nenhum deploy registrado ainda.</p>;

  return (
    <div className="divide-y divide-border">
      {deployments.map((deployment) => {
        const expanded = open === deployment.externalId;
        return (
          <div key={deployment.id}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? null : deployment.externalId)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-surface"
            >
              <span className="flex min-w-0 items-start gap-2">
                {expanded ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted" />}
                <span className="min-w-0">
                  <span className={cn("block font-medium", STATUS_CLASSES[deployment.status])}>{STATUS_LABEL[deployment.status]}</span>
                  {deployment.commit && (
                    <span className="block truncate font-mono text-xs text-muted">
                      {deployment.commit.slice(0, 7)}
                      {deployment.commitMessage ? ` · ${deployment.commitMessage.split("\n")[0]}` : ""}
                    </span>
                  )}
                </span>
              </span>
              <span className="shrink-0 text-right text-xs text-muted">
                {deployment.startedAt && <span className="block">{new Date(deployment.startedAt).toLocaleString("pt-BR")}</span>}
                {formatDuration(deployment.startedAt, deployment.finishedAt) && <span className="block">{formatDuration(deployment.startedAt, deployment.finishedAt)}</span>}
              </span>
            </button>
            {expanded && <DeploymentLog applicationId={applicationId} deployment={deployment} />}
          </div>
        );
      })}
    </div>
  );
}
