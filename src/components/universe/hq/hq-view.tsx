"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useApplications } from "@/hooks/use-applications";
import { useProviders } from "@/hooks/use-providers";
import { useProjects } from "@/hooks/use-projects";
import { useUiStore } from "@/store/ui-store";
import { HqScene } from "./hq-scene";
import { HqErrorBoundary } from "./hq-error-boundary";
import { HqLoading } from "./hq-loading";
import { detectWebglSupport } from "../webgl";
import { DEMO_APPLICATIONS, DEMO_PROJECTS, DEMO_PROVIDERS } from "@/lib/demo-data";
import { Button } from "@/components/ui/button";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { ProjectManagerDrawer } from "@/components/projects/project-manager-drawer";

/**
 * Replaces the old sphere/cluster universe with the ID SYSTEM HQ diorama —
 * same data sources, same Demo Mode / Reduced Graphics / WebGL fallback
 * contract as before, just a different building on top of it.
 */
export function HqView() {
  const [webglOk, setWebglOk] = useState<boolean | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [focusedProjectId, setFocusedProjectId] = useState<string | null>(null);
  const router = useRouter();
  const { selectedApplicationId, selectApplication, reducedGraphics, setReducedGraphics, demoMode, setDemoMode, setViewMode } = useUiStore();

  const { data: realProviders } = useProviders();
  const { data: realApplications } = useApplications();
  const { data: realProjects } = useProjects();

  const providers = demoMode ? DEMO_PROVIDERS : (realProviders ?? []);
  const applications = demoMode ? DEMO_APPLICATIONS : (realApplications ?? []);
  const projects = demoMode ? DEMO_PROJECTS : (realProjects ?? []);
  const focusedProject = focusedProjectId ? projects.find((p) => p.id === focusedProjectId) : undefined;

  // ESC steps back one level at a time: closes the resource panel first (if
  // open), else zooms the camera back out to the overview — never both at
  // once (briefing: "ESC novamente: Italoc -> HQ").
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (selectedApplicationId) {
        selectApplication(null);
        return;
      }
      if (focusedProjectId) {
        setFocusedProjectId(null);
        setSelectedProjectId(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedApplicationId, selectApplication, focusedProjectId]);

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
              selectApplication(id);
            }}
            onOpenProject={(projectId) => {
              if (demoMode) {
                toast.message("This is demo data. Connect a real Coolify instance to manage projects.");
                return;
              }
              router.push(`/projects/${projectId}`);
            }}
            onOpenProvider={() => {
              if (demoMode) {
                toast.message("This is demo data. Connect a real Coolify instance to manage providers.");
                return;
              }
              router.push("/settings/infrastructure");
            }}
            reducedGraphics={reducedGraphics}
            selectedProjectId={selectedProjectId}
            onSelectProject={setSelectedProjectId}
            focusedProjectId={focusedProjectId}
            onFocusProject={(projectId) => {
              setFocusedProjectId(projectId);
              setSelectedProjectId(projectId);
            }}
          />
        </HqErrorBoundary>
      )}

      <div className="absolute left-4 top-4 flex flex-col items-start gap-2">
        {focusedProject && (
          <div className="flex items-center gap-2 rounded-full border border-border bg-surface-raised/80 px-3 py-1.5 text-xs backdrop-blur">
            <button onClick={() => setFocusedProjectId(null)} className="text-muted hover:text-foreground">
              ← Universe
            </button>
            <span className="text-muted">/</span>
            <span className="flex items-center gap-1.5 font-semibold text-foreground">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: focusedProject.accent }} aria-hidden />
              {focusedProject.name}
            </span>
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

      <button
        onClick={() => setReducedGraphics(!reducedGraphics)}
        className="absolute bottom-4 right-4 rounded-full border border-border bg-surface-raised/80 px-3 py-1.5 text-xs text-muted backdrop-blur hover:text-foreground"
      >
        {reducedGraphics ? "Reduced Graphics: On" : "Reduced Graphics: Off"}
      </button>
    </div>
  );
}
