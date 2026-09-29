"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { UniverseApplication, UniverseDeployment, UniverseLogLine } from "@/types/domain";

export interface ApplicationFilter {
  providerId?: string;
  query?: string;
  status?: UniverseApplication["status"];
}

function toQueryString(filter: ApplicationFilter): string {
  const params = new URLSearchParams();
  if (filter.providerId) params.set("providerId", filter.providerId);
  if (filter.query) params.set("q", filter.query);
  if (filter.status) params.set("status", filter.status);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useApplications(filter: ApplicationFilter = {}) {
  return useQuery({
    queryKey: ["applications", filter],
    queryFn: () => apiFetch<{ applications: UniverseApplication[] }>(`/api/applications${toQueryString(filter)}`),
    select: (data) => data.applications,
    // Any application mid-deploy anywhere means the whole board should feel live.
    refetchInterval: (query) => (query.state.data?.applications.some((a) => a.status === "DEPLOYING") ? 4_000 : 20_000),
  });
}

export function useApplicationDetail(id: string | null) {
  return useQuery({
    queryKey: ["applications", "detail", id],
    queryFn: () => apiFetch<{ application: UniverseApplication }>(`/api/applications/${id}`),
    select: (data) => data.application,
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data?.application.status === "DEPLOYING" ? 3_000 : 15_000),
  });
}

export function useApplicationLogs(id: string | null, options: { live: boolean; lines: number }) {
  return useQuery({
    queryKey: ["applications", "logs", id, options.lines],
    queryFn: () => apiFetch<{ lines: UniverseLogLine[]; supportsStreaming: boolean }>(`/api/applications/${id}/logs?lines=${options.lines}`),
    enabled: Boolean(id),
    // Fast poll only while the panel is open and "Live" is on — never in the background.
    refetchInterval: options.live ? 4_000 : false,
  });
}

export function useApplicationDeployments(id: string | null) {
  return useQuery({
    queryKey: ["applications", "deployments", id],
    queryFn: () => apiFetch<{ deployments: UniverseDeployment[] }>(`/api/applications/${id}/deployments`),
    enabled: Boolean(id),
  });
}

function useApplicationAction(action: "start" | "stop" | "restart") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ application: UniverseApplication }>(`/api/applications/${id}/actions/${action}`, { method: "POST" }),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      queryClient.invalidateQueries({ queryKey: ["applications", "detail", id] });
    },
  });
}

export const useStartApplication = () => useApplicationAction("start");
export const useStopApplication = () => useApplicationAction("stop");
export const useRestartApplication = () => useApplicationAction("restart");

export function useRedeployApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, force }: { id: string; force: boolean }) =>
      apiFetch<{ application: UniverseApplication }>(`/api/applications/${id}/actions/redeploy`, {
        method: "POST",
        body: JSON.stringify({ force }),
      }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      queryClient.invalidateQueries({ queryKey: ["applications", "detail", id] });
    },
  });
}

export function useSyncAll() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch("/api/sync", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["applications"] }),
  });
}
