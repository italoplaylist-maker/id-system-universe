"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ProjectHealthBadge } from "@/components/ui/project-health-badge";
import { CreateProjectDialog } from "./create-project-dialog";
import { UnassignedResourcesPanel } from "./unassigned-resources-panel";
import { useProjects, useUnassignedResources } from "@/hooks/use-projects";

/**
 * The Universe never depends on the 3D world to manage Projects — this
 * opens over the HQ (or List View) so create/assign/organize always works,
 * whether or not the Canvas is even rendering.
 */
export function ProjectManagerDrawer() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const router = useRouter();
  const { data: projects } = useProjects();
  const { data: unassigned } = useUnassignedResources();

  const filtered = (projects ?? []).filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="flex items-center gap-2 text-sm text-foreground hover:text-accent">
          <span className="h-2 w-2 rounded-full bg-accent" aria-hidden />
          <span className="font-semibold tabular-nums">{projects?.length ?? 0}</span>
          <span className="text-muted">Projects</span>
          <LayoutGrid className="h-3.5 w-3.5 text-muted" />
        </button>
      </DialogTrigger>
      <DialogContent title="Projects" description="Every real Project, synced status, and anything still unassigned." className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <div className="mb-4 flex items-center gap-2">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search projects…" className="flex-1" />
          <CreateProjectDialog />
        </div>

        <div className="space-y-2">
          {filtered.length === 0 && <p className="py-6 text-center text-sm text-muted">No projects match.</p>}
          {filtered.map((project) => (
            <button
              key={project.id}
              onClick={() => {
                setOpen(false);
                router.push(`/projects/${project.id}`);
              }}
              className="flex w-full items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5 text-left text-sm hover:border-accent/40 hover:bg-surface-raised"
            >
              <div className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: project.accent }} aria-hidden />
                <div>
                  <p className="font-medium text-foreground">{project.name}</p>
                  <p className="text-xs text-muted">
                    {project.resourceCount} resource{project.resourceCount === 1 ? "" : "s"} · {project.providerCount} provider{project.providerCount === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
              <ProjectHealthBadge health={project.health} />
            </button>
          ))}
        </div>

        {(unassigned?.length ?? 0) > 0 && (
          <div className="mt-5 border-t border-border pt-4">
            <UnassignedResourcesPanel />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
