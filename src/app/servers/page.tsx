"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "@/hooks/use-session";
import { useServers } from "@/hooks/use-servers";
import { canUser } from "@/server/auth/rbac";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { formatAgo } from "@/lib/format-metrics";
import { ServerDetail, StatusPill } from "@/components/servers/server-detail";
import { AddServerDialog, DeleteServerButton, RotateTokenButton } from "@/components/servers/server-dialogs";

export default function ServersPage() {
  const { data: user, isLoading: sessionLoading } = useSession();
  // A API exige escopo global; sem ele a leitura devolve 403 e a tela mostra o erro.
  const canView = user ? canUser(user, "provider:read") : false;
  const canManage = user ? canUser(user, "provider:write") : false;
  const { data: servers, isLoading, error } = useServers(canView);
  const [selected, setSelected] = useState<string | null>(null);

  // Sem seleção válida (primeira carga ou servidor removido), cai no primeiro da lista.
  const current = servers?.find((s) => s.id === selected) ?? servers?.[0] ?? null;

  if (!sessionLoading && !canView) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Link href="/" className="text-xs uppercase tracking-[0.2em] text-muted hover:text-foreground">← Voltar ao Universe</Link>
        <p className="mt-4 text-sm text-muted">Você não tem acesso ao monitoramento de servidores.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <Link href="/" className="text-xs uppercase tracking-[0.2em] text-muted hover:text-foreground">← Voltar ao Universe</Link>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-lg font-semibold">NOC · Servidores</h1>
          {canManage && <AddServerDialog />}
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {error ? (
          <p className="text-sm text-status-error">{error instanceof Error ? error.message : "Falha ao carregar servidores."}</p>
        ) : isLoading ? (
          <p className="text-sm text-muted">Carregando…</p>
        ) : !servers?.length ? (
          <Card className="space-y-2 p-8 text-center">
            <p className="text-sm text-foreground">Nenhum servidor monitorado.</p>
            <p className="text-sm text-muted">Adicione uma VPS e instale o agente para acompanhar CPU, memória, disco, rede e containers em tempo real.</p>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Servidores">
              {servers.map((s) => (
                <button
                  key={s.id}
                  role="tab"
                  aria-selected={s.id === current?.id}
                  onClick={() => setSelected(s.id)}
                  className={cn("flex items-center gap-3 rounded-lg border px-4 py-2 text-left", s.id === current?.id ? "border-accent bg-surface-raised" : "border-border bg-surface hover:border-accent/50")}
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">{s.name}</p>
                    <p className="text-[11px] text-muted">{s.status === "WAITING" ? "sem sinal ainda" : formatAgo(s.lastSeenAt)}</p>
                  </div>
                  <StatusPill status={s.status} />
                </button>
              ))}
            </div>

            {current && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <h2 className="text-base font-semibold text-foreground">{current.name}</h2>
                    <StatusPill status={current.status} />
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-2">
                      <RotateTokenButton serverId={current.id} />
                      <DeleteServerButton serverId={current.id} name={current.name} onDeleted={() => setSelected(null)} />
                    </div>
                  )}
                </div>
                <ServerDetail server={current} />
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
