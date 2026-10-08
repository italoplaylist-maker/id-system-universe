"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { GitHubRepositorySummary } from "@/server/github/github-service";
import type { ResourceRepositoryView } from "@/server/github/resource-repository";
import type { DeploymentRunSummary } from "@/server/deployments/deployment-runs";

export function useGitHubRepositories(enabled = true) {
  return useQuery({
    queryKey: ["github", "repositories"],
    queryFn: () => apiFetch<{ repositories: GitHubRepositorySummary[] }>("/api/github/repositories"),
    select: (data) => data.repositories,
    enabled,
  });
}

export function useGitHubBranches(repositoryId: string | null) {
  return useQuery({
    queryKey: ["github", "branches", repositoryId],
    queryFn: () => apiFetch<{ branches: string[] }>(`/api/github/repositories/${repositoryId}/branches`),
    select: (data) => data.branches,
    enabled: Boolean(repositoryId),
    retry: false,
  });
}

export function useResourceRepository(applicationId: string | null) {
  return useQuery({
    queryKey: ["github", "resource", applicationId],
    queryFn: () => apiFetch<{ repository: ResourceRepositoryView | null }>(`/api/applications/${applicationId}/repository`),
    select: (data) => data.repository,
    enabled: Boolean(applicationId),
  });
}

export function useSetResourceRepository(applicationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { githubRepositoryId: string; branch: string; autoDeploy: boolean; onPush: boolean; onMerge: boolean }) =>
      apiFetch(`/api/applications/${applicationId}/repository`, { method: "PUT", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["github", "resource", applicationId] }),
  });
}

export function useRemoveResourceRepository(applicationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch(`/api/applications/${applicationId}/repository`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["github", "resource", applicationId] }),
  });
}

export function useDeploymentRuns(applicationId: string | null) {
  return useQuery({
    queryKey: ["github", "runs", applicationId],
    queryFn: () => apiFetch<{ production: DeploymentRunSummary | null; queued: DeploymentRunSummary | null; runs: DeploymentRunSummary[] }>(`/api/applications/${applicationId}/runs`),
    enabled: Boolean(applicationId),
    refetchInterval: 8_000,
  });
}
