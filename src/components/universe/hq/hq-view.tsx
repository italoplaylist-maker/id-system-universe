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
import { detectWebglSupport } from "../webgl";
import { DEMO_APPLICATIONS, DEMO_PROJECTS, DEMO_PROVIDERS } from "@/lib/demo-data";
import { Button } from "@/components/ui/button";

/**
 * Replaces the old sphere/cluster universe with the ID SYSTEM HQ diorama —
 * same data sources, same Demo Mode / Reduced Graphics / WebGL fallback
 * contract as before, just a different building on top of it.
 */
export function HqView() {
  const [webglOk, setWebglOk] = useState<boolean | null>(null);
  const router = useRouter();
  const { selectedApplicationId, selectApplication, reducedGraphics, setReducedGraphics, demoMode, setDemoMode, setViewMode } = useUiStore();

  const { data: realProviders } = useProviders();
  const { data: realApplications } = useApplications();
  const { data: realProjects } = useProjects();

  const providers = demoMode ? DEMO_PROVIDERS : (realProviders ?? []);
  const applications = demoMode ? DEMO_APPLICATIONS : (realApplications ?? []);
  const projects = demoMode ? DEMO_PROJECTS : (realProjects ?? []);

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

  if (webglOk === null) return null;

  const noRealProviders = !demoMode && (realProviders?.length ?? 0) === 0;

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
      ) : (
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
        />
      )}

      {demoMode && (
        <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full border border-status-warning/40 bg-status-warning/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-status-warning">
          Demo Mode
          <button className="underline" onClick={() => setDemoMode(false)}>
            Exit
          </button>
        </div>
      )}

      <button
        onClick={() => setReducedGraphics(!reducedGraphics)}
        className="absolute bottom-4 right-4 rounded-full border border-border bg-surface-raised/80 px-3 py-1.5 text-xs text-muted backdrop-blur hover:text-foreground"
      >
        {reducedGraphics ? "Reduced Graphics: On" : "Reduced Graphics: Off"}
      </button>
    </div>
  );
}
