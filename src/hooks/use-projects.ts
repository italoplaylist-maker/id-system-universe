"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { ProjectSuggestion, UniverseProject, UniverseProjectDetail } from "@/types/domain";

export function useProjects(includeArchived = false) {
  return useQuery({
    queryKey: ["projects", { includeArchived }],
    queryFn: () => apiFetch<{ projects: UniverseProject[] }>(`/api/projects${includeArchived ? "?includeArchived=true" : ""}`),
    select: (data) => data.projects,
    refetchInterval: 20_000,
  });
}

export function useProjectDetail(id: string | null) {
  return useQuery({
    queryKey: ["projects", "detail", id],
    queryFn: () => apiFetch<{ project: UniverseProjectDetail }>(`/api/projects/${id}`),
    select: (data) => data.project,
    enabled: Boolean(id),
    refetchInterval: 10_000,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description?: string; icon?: string; accent?: string }) =>
      apiFetch<{ project: UniverseProject }>("/api/projects", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; name?: string; description?: string | null; icon?: string | null; accent?: string; enabled?: boolean; archived?: boolean }) =>
      apiFetch<{ project: UniverseProject }>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["projects", "detail", id] });
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/api/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    },
  });
}

export function useUnassignedResources() {
  return useQuery({
    queryKey: ["applications", { unassigned: true }],
    queryFn: () => apiFetch<{ applications: import("@/types/domain").UniverseApplication[] }>("/api/applications?unassigned=true"),
    select: (data) => data.applications,
    refetchInterval: 20_000,
  });
}

export function useProjectSuggestions() {
  return useQuery({
    queryKey: ["projects", "suggestions"],
    queryFn: () => apiFetch<{ suggestions: ProjectSuggestion[] }>("/api/projects/suggestions"),
    select: (data) => data.suggestions,
  });
}

export function useAssignResources() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, resourceIds }: { projectId: string; resourceIds: string[] }) =>
      apiFetch<{ assigned: number }>(`/api/projects/${projectId}/resources`, { method: "POST", body: JSON.stringify({ resourceIds }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    },
  });
}

export function useUnassignResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (resourceId: string) => apiFetch(`/api/applications/${resourceId}/unassign`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    },
  });
}
