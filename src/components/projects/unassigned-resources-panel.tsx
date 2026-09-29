"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useAssignResources, useProjectSuggestions, useProjects, useUnassignedResources } from "@/hooks/use-projects";
import { ApiClientError } from "@/lib/api-client";
import type { ProjectSuggestion } from "@/types/domain";

function SuggestionRow({ suggestion }: { suggestion: ProjectSuggestion }) {
  const assign = useAssignResources();

  async function accept() {
    if (!suggestion.matchedProjectId) return;
    try {
      await assign.mutateAsync({ projectId: suggestion.matchedProjectId, resourceIds: suggestion.resourceIds });
      toast.success(`Assigned ${suggestion.resourceNames.length} resource(s) to ${suggestion.matchedProjectName}.`);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Could not assign resources.");
    }
  }

  if (!suggestion.matchedProjectId) return null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-sm">
      <div>
        <p className="text-muted">{suggestion.resourceNames.join(", ")}</p>
        <p>
          Suggested project: <span className="font-medium">{suggestion.matchedProjectName}</span>
        </p>
      </div>
      <Button variant="primary" size="sm" onClick={accept} disabled={assign.isPending}>
        Accept
      </Button>
    </div>
  );
}

export function UnassignedResourcesPanel() {
  const { data: resources, isLoading } = useUnassignedResources();
  const { data: suggestions } = useProjectSuggestions();
  const { data: projects } = useProjects();
  const assign = useAssignResources();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetProjectId, setTargetProjectId] = useState("");

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAssign() {
    if (!targetProjectId || selected.size === 0) return;
    try {
      await assign.mutateAsync({ projectId: targetProjectId, resourceIds: [...selected] });
      toast.success(`${selected.size} resource(s) assigned.`);
      setSelected(new Set());
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Could not assign resources.");
    }
  }

  if (!isLoading && resources?.length === 0 && (!suggestions || suggestions.length === 0)) return null;

  return (
    <Card className="mb-6">
      <CardHeader>
        <h3 className="text-sm font-semibold">Unassigned Resources</h3>
        <span className="text-xs text-muted">{resources?.length ?? 0} unassigned</span>
      </CardHeader>
      <CardContent className="space-y-3">
        {suggestions && suggestions.length > 0 && (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted">
              <Sparkles className="h-3.5 w-3.5" /> Suggestions
            </p>
            {suggestions.map((s) => (
              <SuggestionRow key={s.stem} suggestion={s} />
            ))}
          </div>
        )}

        {resources && resources.length > 0 && (
          <div className="space-y-2">
            {resources.map((resource) => (
              <label key={resource.id} className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 text-sm hover:border-accent/40">
                <input type="checkbox" checked={selected.has(resource.id)} onChange={() => toggle(resource.id)} className="accent-accent" />
                <span className="flex-1">{resource.name}</span>
                <span className="text-xs text-muted">{resource.providerName}</span>
                <StatusBadge status={resource.status} />
              </label>
            ))}

            <div className="flex items-center gap-2 pt-2">
              <select
                value={targetProjectId}
                onChange={(e) => setTargetProjectId(e.target.value)}
                className="h-9 flex-1 rounded-md border border-border bg-surface px-3 text-sm text-foreground"
              >
                <option value="">Assign selected to…</option>
                {projects?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Button variant="primary" size="sm" disabled={!targetProjectId || selected.size === 0 || assign.isPending} onClick={handleAssign}>
                Assign to Project
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
