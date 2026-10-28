"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { MetricPoint, RangeKey, ServerOverview } from "@/server/monitoring/server-service";

export type { MetricPoint, RangeKey, ServerOverview };

export function useServers(enabled = true) {
  return useQuery({
    queryKey: ["servers"],
    queryFn: () => apiFetch<{ servers: ServerOverview[] }>("/api/servers"),
    select: (data) => data.servers,
    enabled,
    refetchInterval: 10_000,
  });
}

export function useServerMetrics(id: string | null, range: RangeKey) {
  return useQuery({
    queryKey: ["servers", id, "metrics", range],
    queryFn: () => apiFetch<{ bucketSeconds: number; points: MetricPoint[] }>(`/api/servers/${id}/metrics?range=${range}`),
    enabled: !!id,
    refetchInterval: range === "1h" ? 15_000 : 60_000,
  });
}

export function useServerMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["servers"] });
  return {
    create: useMutation({
      mutationFn: (name: string) => apiFetch<{ server: { id: string; name: string; token: string } }>("/api/servers", { method: "POST", body: JSON.stringify({ name }) }),
      onSuccess: refresh,
    }),
    rotate: useMutation({
      mutationFn: (id: string) => apiFetch<{ token: string }>(`/api/servers/${id}/token`, { method: "POST" }),
    }),
    remove: useMutation({
      mutationFn: (id: string) => apiFetch<void>(`/api/servers/${id}`, { method: "DELETE" }),
      onSuccess: refresh,
    }),
  };
}
