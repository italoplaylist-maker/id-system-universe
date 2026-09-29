"use client";

import { useMemo, useState } from "react";
import { useApplications } from "@/hooks/use-applications";
import { useProviders } from "@/hooks/use-providers";
import { useProjects } from "@/hooks/use-projects";
import { useUiStore } from "@/store/ui-store";
import { StatusBadge } from "@/components/ui/status-badge";
import { ProjectHealthBadge } from "@/components/ui/project-health-badge";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import type { UniverseApplication, UniverseApplicationStatus } from "@/types/domain";

const STATUS_FILTERS: (UniverseApplicationStatus | "ALL")[] = ["ALL", "RUNNING", "DEPLOYING", "STOPPED", "ERROR", "UNKNOWN"];
const UNASSIGNED_KEY = "__unassigned__";

function ResourceCard({ app, onClick }: { app: UniverseApplication; onClick: () => void }) {
  return (
    <Card className="cursor-pointer p-4 transition-colors hover:border-accent/50" onClick={onClick}>
      <div className="flex items-start justify-between">
        <div>
          <p className="font-medium">{app.name}</p>
          <p className="text-xs text-muted">{app.providerName}</p>
        </div>
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: app.providerColor }} aria-hidden />
      </div>
      <div className="mt-3">
        <StatusBadge status={app.status} />
      </div>
      {app.branch && <p className="mt-2 truncate text-xs text-muted">{app.branch}</p>}
    </Card>
  );
}

export function ListView() {
  const [query, setQuery] = useState("");
  const [providerId, setProviderId] = useState<string | undefined>(undefined);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<UniverseApplicationStatus | "ALL">("ALL");
  const { selectApplication } = useUiStore();

  const { data: providers } = useProviders();
  const { data: projects } = useProjects();
  const { data: applications, isLoading } = useApplications({
    query: query || undefined,
    providerId,
    projectId,
    status: status === "ALL" ? undefined : status,
  });

  const grouped = useMemo(() => {
    const groups = new Map<string, { name: string; accent: string | null; resources: UniverseApplication[] }>();
    for (const app of applications ?? []) {
      const key = app.projectId ?? UNASSIGNED_KEY;
      const group = groups.get(key) ?? { name: app.projectName ?? "Unassigned", accent: app.projectAccent, resources: [] };
      group.resources.push(app);
      groups.set(key, group);
    }
    // Unassigned always sorts last.
    return [...groups.entries()].sort(([a], [b]) => (a === UNASSIGNED_KEY ? 1 : b === UNASSIGNED_KEY ? -1 : a.localeCompare(b)));
  }, [applications]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <Input placeholder="Search resources…" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-xs" />
        <select
          value={projectId ?? "ALL"}
          onChange={(e) => setProjectId(e.target.value === "ALL" ? undefined : e.target.value)}
          className="h-10 rounded-md border border-border bg-surface px-3 text-sm text-foreground"
        >
          <option value="ALL">All Projects</option>
          {projects?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={providerId ?? "ALL"}
          onChange={(e) => setProviderId(e.target.value === "ALL" ? undefined : e.target.value)}
          className="h-10 rounded-md border border-border bg-surface px-3 text-sm text-foreground"
        >
          <option value="ALL">All Providers</option>
          {providers?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-full border px-3 py-1 text-xs ${
                status === s ? "border-accent text-accent" : "border-border text-muted hover:text-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        {isLoading && <p className="text-sm text-muted">Loading resources…</p>}
        {!isLoading && applications?.length === 0 && <p className="text-sm text-muted">No resources match.</p>}

        {grouped.map(([key, group]) => {
          const project = projects?.find((p) => p.id === key);
          return (
            <section key={key}>
              <div className="mb-2 flex items-center gap-2">
                {group.accent && <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: group.accent }} aria-hidden />}
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{group.name}</h3>
                {project && <ProjectHealthBadge health={project.health} />}
                <span className="text-xs text-muted">{group.resources.length}</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {group.resources.map((app) => (
                  <ResourceCard key={app.id} app={app} onClick={() => selectApplication(app.id)} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
