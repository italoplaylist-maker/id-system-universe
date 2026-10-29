"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/hooks/use-session";
import { useAgentSessions } from "@/hooks/use-agents";
import { useCameraStore } from "@/store/camera-store";
import { useUiStore } from "@/store/ui-store";
import { canUser } from "@/server/auth/rbac";
import { AgentsScene } from "@/components/universe/hq/agents-scene";
import { HqErrorBoundary } from "@/components/universe/hq/hq-error-boundary";
import { HqLoading } from "@/components/universe/hq/hq-loading";
import { detectWebglSupport } from "@/components/universe/webgl";
import { FeedsDialog } from "@/components/agents/feed-dialogs";
import { TimelinePanel } from "@/components/agents/timeline-panel";

export default function AgentsPage() {
  const { data: user, isLoading: sessionLoading } = useSession();
  const canView = user ? canUser(user, "provider:read") : false;
  const canManage = user ? canUser(user, "provider:write") : false;
  const { data: sessions, error } = useAgentSessions(canView);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [webglOk, setWebglOk] = useState<boolean | null>(null);
  const reducedGraphics = useUiStore((s) => s.reducedGraphics);
  const resetCamera = useCameraStore((s) => s.reset);
  const backOneLevel = useCameraStore((s) => s.backOneLevel);
  const cameraMode = useCameraStore((s) => s.mode);

  useEffect(() => {
    resetCamera();
  }, [resetCamera]);

  useEffect(() => {
    // WebGL só pode ser detectado no cliente, depois de montar.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWebglOk(detectWebglSupport());
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (selectedId) setSelectedId(null);
      else if (cameraMode !== "overview") backOneLevel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, cameraMode, backOneLevel]);

  const selected = sessions?.find((s) => s.id === selectedId) ? selectedId : null;

  if (!sessionLoading && !canView) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Link href="/" className="text-xs uppercase tracking-[0.2em] text-muted hover:text-foreground">← Voltar ao Universe</Link>
        <p className="mt-4 text-sm text-muted">Você não tem acesso à sala de agentes.</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <div>
          <Link href="/" className="text-xs uppercase tracking-[0.2em] text-muted hover:text-foreground">← Voltar ao Universe</Link>
          <h1 className="text-lg font-semibold">Sala dos Agentes Claude</h1>
        </div>
        {canManage && <FeedsDialog />}
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {error ? (
          <p className="p-6 text-sm text-status-error">{error instanceof Error ? error.message : "Falha ao carregar os agentes."}</p>
        ) : webglOk === null || !sessions ? (
          <HqLoading />
        ) : !webglOk ? (
          <p className="p-6 text-sm text-muted">3D indisponível neste dispositivo.</p>
        ) : (
          <HqErrorBoundary onOpenListView={() => undefined}>
            <AgentsScene sessions={sessions} selectedId={selected} onSelect={setSelectedId} reducedGraphics={reducedGraphics} />
          </HqErrorBoundary>
        )}
        {sessions && sessions.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center px-4">
            <p className="rounded-full border border-border bg-surface-raised/90 px-4 py-2 text-xs text-muted backdrop-blur">
              Nenhum agente ativo. {canManage ? "Use “Fontes” para conectar suas sessões na nuvem." : "Peça a um administrador para conectar uma fonte."}
            </p>
          </div>
        )}
        {selected && <TimelinePanel sessionId={selected} onClose={() => setSelectedId(null)} />}
      </div>
    </div>
  );
}
