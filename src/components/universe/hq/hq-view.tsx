"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useApplications } from "@/hooks/use-applications";
import { useProviders } from "@/hooks/use-providers";
import { useProjects } from "@/hooks/use-projects";
import { useUiStore } from "@/store/ui-store";
import { useCameraStore } from "@/store/camera-store";
import { HqScene } from "./hq-scene";
import { HqErrorBoundary } from "./hq-error-boundary";
import { HqLoading } from "./hq-loading";
import { detectWebglSupport } from "../webgl";
import { useEnvironmentState } from "./environment/use-environment-state";
import { WeatherHud } from "./environment/weather-hud";
import { HQ_LOCATION } from "@/lib/hq-location";
import { DEMO_APPLICATIONS, DEMO_PROJECTS, DEMO_PROVIDERS } from "@/lib/demo-data";
import { Button } from "@/components/ui/button";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { TimelinePanel } from "@/components/agents/timeline-panel";
import { FeedsDialog } from "@/components/agents/feed-dialogs";
import { NotificationsDialog } from "@/components/notifications/notifications-dialog";
import { CommandCenter } from "@/components/agents/command-center";
import { useAgentSessions } from "@/hooks/use-agents";
import { useSession } from "@/hooks/use-session";
import { canUser } from "@/server/auth/rbac";
import { motion } from "motion/react";
import { useHqViews } from "@/store/hq-views-store";
import { MotionPanelSlot } from "@/components/ui/motion-panel";
import { QUALITY_ORDER, QUALITY_PROFILES } from "./render/quality";
import { ProjectManagerDrawer } from "@/components/projects/project-manager-drawer";

/**
 * Replaces the old sphere/cluster universe with the ID SYSTEM HQ diorama —
 * same data sources, same Demo Mode / Reduced Graphics / WebGL fallback
 * contract as before, just a different building on top of it.
 */
export function HqView() {
  const [webglOk, setWebglOk] = useState<boolean | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [centerOpen, setCenterOpen] = useState(false);
  const mountedAt = useRef(0);
  const { data: sessionUser } = useSession();
  const { data: observedSessions } = useAgentSessions(sessionUser ? canUser(sessionUser, "provider:read") : false);
  const canManageAgents = sessionUser ? canUser(sessionUser, "provider:write") : false;
  const router = useRouter();
  const { selectedApplicationId, selectApplication, quality, setQuality, hydrateQuality, reducedGraphics, demoMode, setDemoMode, setViewMode } = useUiStore();
  const cameraMode = useCameraStore((s) => s.mode);
  const focusLabel = useCameraStore((s) => s.focusLabel);
  const resetCamera = useCameraStore((s) => s.reset);
  const focusProject = useCameraStore((s) => s.focusProject);
  const hqViews = useHqViews((s) => s.views);
  const backOneLevel = useCameraStore((s) => s.backOneLevel);
  const env = useEnvironmentState();
  const timeLabel = (() => {
    try {
      return new Intl.DateTimeFormat("pt-BR", { timeZone: HQ_LOCATION.timezone, hour: "2-digit", minute: "2-digit" }).format(env.now);
    } catch {
      return "--:--";
    }
  })();

  const { data: realProviders } = useProviders();
  const { data: realApplications } = useApplications();
  const { data: realProjects } = useProjects();

  const providers = demoMode ? DEMO_PROVIDERS : (realProviders ?? []);
  const applications = demoMode ? DEMO_APPLICATIONS : (realApplications ?? []);
  const projects = demoMode ? DEMO_PROJECTS : (realProjects ?? []);

  // ESC steps back one level at a time: closes the resource panel first (if
  // open), else returns the camera to the overview — never both at once
  // (briefing: "ESC novamente: Italoc -> HQ").
  useEffect(() => {
    hydrateQuality();
    mountedAt.current = Date.now();
  }, [hydrateQuality]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (centerOpen) {
        setCenterOpen(false);
        return;
      }
      if (selectedAgentId) {
        setSelectedAgentId(null);
        return;
      }
      if (selectedApplicationId) {
        selectApplication(null);
        return;
      }
      if (cameraMode !== "overview") backOneLevel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [centerOpen, selectedAgentId, selectedApplicationId, selectApplication, cameraMode, backOneLevel]);

  useEffect(() => {
    // WebGL support can only be known client-side (canvas probing needs
    // `window`), so this genuinely has to run after mount rather than be
    // derived during render — hence the lint exception below.
    const ok = detectWebglSupport();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWebglOk(ok);
    if (!ok) {
      toast.message("3D graphics unavailable on this device. Showing List View instead.");
      setViewMode("LIST");
    }
  }, [setViewMode]);

  if (webglOk === null) return <HqLoading />;

  const noRealProviders = !demoMode && (realProviders?.length ?? 0) === 0;
  const realResourceCount = realApplications?.length ?? 0;
  // The building isn't the source of truth for "no Projects yet" — real
  // resources exist (Coolify sync worked) but nothing has been organized
  // into a Project, so there's nothing to draw a room for. Say that plainly
  // instead of rendering a near-empty diorama that reads as broken.
  const noProjectsYet = !demoMode && !noRealProviders && (realProjects?.length ?? 0) === 0 && realResourceCount > 0;

  return (
    <div className="relative flex-1 overflow-hidden">
      {noRealProviders ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
          <p className="text-sm text-muted">No infrastructure connected yet.</p>
          <div className="flex gap-3">
            <Link href="/settings/infrastructure">
              <Button variant="primary">Connect Coolify</Button>
            </Link>
            <Button variant="secondary" onClick={() => setDemoMode(true)}>
              Explore Demo Headquarters
            </Button>
          </div>
        </div>
      ) : noProjectsYet ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-foreground">Your Universe has no Projects yet</p>
          <p className="max-w-sm text-sm text-muted">
            {realResourceCount} Coolify resource{realResourceCount === 1 ? "" : "s"} {realResourceCount === 1 ? "was" : "were"} discovered. Organize{" "}
            {realResourceCount === 1 ? "it" : "them"} into Projects to build your HQ.
          </p>
          <div className="mt-1 flex gap-3">
            <CreateProjectDialog />
            <ProjectManagerDrawer />
          </div>
        </div>
      ) : (
        <HqErrorBoundary onOpenListView={() => setViewMode("LIST")}>
          <HqScene
            providers={providers}
            projects={projects}
            applications={applications}
            selectedApplicationId={selectedApplicationId}
            onSelectApplication={(id) => {
              if (demoMode) {
                toast.message("This is demo data. Connect a real Coolify instance to control resources.");
                return;
              }
              setSelectedAgentId(null);
              selectApplication(id);
            }}
            onOpenProvider={() => {
              if (demoMode) {
                toast.message("This is demo data. Connect a real Coolify instance to manage providers.");
                return;
              }
              router.push("/settings/infrastructure");
            }}
            onOpenServers={() => router.push("/servers")}
            onOpenActivity={() => router.push("/activity")}
            onPerformanceDecline={() => {
              // FPS sustentadamente baixo: desce um nível (só nesta sessão) e avisa; o usuário pode voltar pelo seletor.
              // Ignora os primeiros 20 s (carga de modelos/texturas causa picos) e abas em segundo plano.
              if (Date.now() - mountedAt.current < 20_000 || document.visibilityState !== "visible") return;
              const next = quality === "high" ? "medium" : quality === "medium" ? "low" : null;
              if (!next) return;
              setQuality(next, { persist: false });
              toast.message(`Desempenho baixo: qualidade gráfica reduzida para ${QUALITY_PROFILES[next].label}.`);
            }}
            dataReady={demoMode || (realApplications !== undefined && realProjects !== undefined)}
            selectedAgentId={selectedAgentId}
            onSelectAgent={(id) => {
              selectApplication(null);
              // Funcionário permanente → Central de comandos; sessão observada pelo hook → linha do tempo.
              // Só é sessão observada (linha do tempo) se o hook de fato a conhece; qualquer outro funcionário abre a Central.
              if (!observedSessions?.some((s) => s.id === id)) {
                setSelectedAgentId(id);
                setCenterOpen(true);
              } else {
                setCenterOpen(false);
                setSelectedAgentId(id);
              }
            }}
            reducedGraphics={reducedGraphics}
            quality={quality}
            env={env}
          />
        </HqErrorBoundary>
      )}

      <div className="absolute left-4 top-4 flex flex-col items-start gap-2">
        {focusLabel && cameraMode !== "overview" && cameraMode !== "free" && (
          <div className="flex items-center gap-2 rounded-full border border-border bg-surface-raised/80 px-3 py-1.5 text-xs backdrop-blur">
            <button onClick={() => resetCamera()} className="text-muted hover:text-foreground">
              ← Universe
            </button>
            <span className="text-muted">/</span>
            <span className="font-semibold text-foreground">{focusLabel}</span>
          </div>
        )}

        {demoMode && (
          <div className="flex items-center gap-2 rounded-full border border-status-warning/40 bg-status-warning/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-status-warning">
            Demo Mode
            <button className="underline" onClick={() => setDemoMode(false)}>
              Exit
            </button>
          </div>
        )}
      </div>

      <div className="absolute right-4 top-4">
        <WeatherHud timeLabel={timeLabel} />
      </div>

      <MotionPanelSlot panelKey={centerOpen ? "center" : selectedAgentId ? `timeline:${selectedAgentId}` : null}>
        {centerOpen ? (
          <CommandCenter initialAgentId={selectedAgentId} onClose={() => setCenterOpen(false)} canWrite={canManageAgents} />
        ) : (
          selectedAgentId && <TimelinePanel sessionId={selectedAgentId} onClose={() => setSelectedAgentId(null)} canSend={canManageAgents} />
        )}
      </MotionPanelSlot>

      <div className="absolute bottom-4 left-4 right-4 flex flex-wrap items-center justify-end gap-2 pointer-events-none [&>*]:pointer-events-auto">
        {sessionUser && canUser(sessionUser, "provider:read") && (
          <button onClick={() => setCenterOpen((v) => !v)} className="flex items-center gap-1.5 rounded-full border border-border bg-surface-raised/80 px-3 py-1.5 text-xs text-muted backdrop-blur hover:text-foreground">
            Central de Agentes
          </button>
        )}
        <NotificationsDialog variant="pill" />
        {hqViews.length > 0 && (
          <div role="group" aria-label="Posições de câmera" className="flex items-center rounded-full border border-border bg-surface-raised/80 p-0.5 text-xs backdrop-blur">
            <button onClick={() => resetCamera()} className={`rounded-full px-2.5 py-1 transition-colors ${cameraMode === "overview" ? "text-foreground" : "text-muted hover:text-foreground"}`}>
              Sede
            </button>
            {hqViews.map((v) => (
              <button key={v.id} onClick={() => focusProject(`view:${v.id}`, v.center, v.radius, v.label)} className="rounded-full px-2.5 py-1 text-muted transition-colors hover:text-foreground">
                {v.label}
              </button>
            ))}
          </div>
        )}
        {canManageAgents && <FeedsDialog />}
        {cameraMode !== "overview" && (
          <button
            onClick={() => resetCamera()}
            title="Visão Geral (Home)"
            className="flex items-center gap-1.5 rounded-full border border-border bg-surface-raised/80 px-3 py-1.5 text-xs text-muted backdrop-blur hover:text-foreground"
          >
            <span aria-hidden>⌂</span> Visão Geral
          </button>
        )}
        <div role="radiogroup" aria-label="Qualidade gráfica" className="flex items-center rounded-full border border-border bg-surface-raised/80 p-0.5 text-xs backdrop-blur">
          <span className="px-2 text-muted">Gráficos</span>
          {QUALITY_ORDER.map((q) => (
            <button
              key={q}
              role="radio"
              aria-checked={quality === q}
              onClick={() => setQuality(q)}
              className={`relative rounded-full px-2.5 py-1 transition-colors ${quality === q ? "text-white" : "text-muted hover:text-foreground"}`}
            >
              {quality === q && <motion.span layoutId="quality-pill" className="absolute inset-0 -z-0 rounded-full bg-accent" transition={{ type: "spring", visualDuration: 0.25, bounce: 0.15 }} />}
              <span className="relative">{QUALITY_PROFILES[q].label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
