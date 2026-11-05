"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { RoomAgentView, TaskView, TaskEventView } from "@/server/orchestrator/service";
export { roomAgentToSession } from "@/lib/room-agent";

export type { RoomAgentView, TaskView, TaskEventView };

const KEY = ["orchestrator"] as const;

/**
 * Tempo real: o SSE só avisa "mudou"; os dados vêm sempre da API (fonte única de verdade).
 * Sem SSE (proxy que corta, aba em segundo plano) o polling lento de cada query continua valendo.
 */
export function useOrchestratorStream(enabled: boolean) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    const es = new EventSource("/api/orchestrator/stream");
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      // Rajadas de eventos (texto parcial, ferramentas) viram uma única atualização.
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void queryClient.invalidateQueries({ queryKey: KEY });
      }, 150);
    };
    es.addEventListener("change", refresh);
    return () => {
      if (timer) clearTimeout(timer);
      es.close();
    };
  }, [enabled, queryClient]);
}

export function useRoomAgents(enabled = true) {
  return useQuery({
    queryKey: [...KEY, "agents"],
    queryFn: () => apiFetch<{ agents: RoomAgentView[] }>("/api/orchestrator/agents"),
    select: (d) => d.agents,
    enabled,
    refetchInterval: 5_000,
  });
}

export function useOrchestratorTasks(scope: "active" | "history", agentId: string | null, enabled = true) {
  return useQuery({
    queryKey: [...KEY, "tasks", scope, agentId],
    queryFn: () => apiFetch<{ tasks: TaskView[] }>(`/api/orchestrator/tasks?scope=${scope}${agentId ? `&agentId=${agentId}` : ""}`),
    select: (d) => d.tasks,
    enabled,
    refetchInterval: 5_000,
  });
}

export function useTaskDetail(taskId: string | null) {
  return useQuery({
    queryKey: [...KEY, "task", taskId],
    queryFn: () => apiFetch<{ task: TaskView; events: TaskEventView[]; approval: { id: string; tool: string; detail: string } | null }>(`/api/orchestrator/tasks/${taskId}`),
    enabled: !!taskId,
    refetchInterval: 4_000,
  });
}

export function useOrchestratorStatus(enabled = true) {
  return useQuery({
    queryKey: [...KEY, "status"],
    queryFn: () => apiFetch<{ authenticated: boolean; method: "assinatura" | "api" | "provedor" | null; loginInProgress: boolean }>("/api/orchestrator/status"),
    enabled,
    staleTime: 10_000,
  });
}

export function useOrchestratorSettings(enabled = true) {
  return useQuery({
    queryKey: [...KEY, "settings"],
    queryFn: () => apiFetch<{ settings: { maxConcurrent: number } }>("/api/orchestrator/settings"),
    select: (d) => d.settings,
    enabled,
  });
}

export function useOrchestratorMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });
  return {
    /** A chave de idempotência é gerada pelo chamador UMA vez por comando: reenviar a mesma chave nunca duplica. */
    submit: useMutation({
      mutationFn: ({ agentId, prompt, idempotencyKey }: { agentId: string; prompt: string; idempotencyKey: string }) =>
        apiFetch<{ task: TaskView; duplicate: boolean }>(`/api/orchestrator/agents/${agentId}/tasks`, { method: "POST", body: JSON.stringify({ prompt, idempotencyKey }) }),
      onSettled: refresh,
    }),
    cancel: useMutation({ mutationFn: (taskId: string) => apiFetch<{ status: string }>(`/api/orchestrator/tasks/${taskId}/cancel`, { method: "POST" }), onSettled: refresh }),
    decide: useMutation({
      mutationFn: ({ id, decision }: { id: string; decision: "allow" | "deny" }) => apiFetch(`/api/orchestrator/approvals/${id}`, { method: "POST", body: JSON.stringify({ decision }) }),
      onSettled: refresh,
    }),
    createAgent: useMutation({
      mutationFn: (input: { name: string; specialty?: string; cwd: string; model?: string; permissionMode?: string }) =>
        apiFetch<{ agent: { id: string } }>("/api/orchestrator/agents", { method: "POST", body: JSON.stringify(input) }),
      onSettled: refresh,
    }),
    updateAgent: useMutation({
      mutationFn: ({ id, ...input }: { id: string; name?: string; specialty?: string; cwd?: string; model?: string; permissionMode?: string; paused?: boolean }) =>
        apiFetch(`/api/orchestrator/agents/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
      onSettled: refresh,
    }),
    archiveAgent: useMutation({ mutationFn: (id: string) => apiFetch(`/api/orchestrator/agents/${id}`, { method: "DELETE" }), onSettled: refresh }),
    startLogin: useMutation({ mutationFn: () => apiFetch<{ url: string }>("/api/orchestrator/auth/login", { method: "POST" }) }),
    submitLoginCode: useMutation({ mutationFn: (code: string) => apiFetch("/api/orchestrator/auth/code", { method: "POST", body: JSON.stringify({ code }) }), onSettled: refresh }),
    logout: useMutation({ mutationFn: () => apiFetch("/api/orchestrator/auth/logout", { method: "POST" }), onSettled: refresh }),
    setConcurrency: useMutation({
      mutationFn: (maxConcurrent: number) => apiFetch("/api/orchestrator/settings", { method: "PATCH", body: JSON.stringify({ maxConcurrent }) }),
      onSettled: refresh,
    }),
  };
}
