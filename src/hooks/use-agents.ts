"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { AgentCommandView, AgentSessionView, AgentTimelineItem } from "@/server/claude/agent-service";

export type { AgentCommandView, AgentSessionView, AgentTimelineItem };

export function useAgentSessions(enabled = true) {
  return useQuery({
    queryKey: ["agents", "sessions"],
    queryFn: () => apiFetch<{ sessions: AgentSessionView[] }>("/api/claude/sessions"),
    select: (data) => data.sessions,
    enabled,
    refetchInterval: 2_500,
  });
}

export function useAgentTimeline(id: string | null) {
  return useQuery({
    queryKey: ["agents", "timeline", id],
    queryFn: () => apiFetch<{ session: AgentSessionView; events: AgentTimelineItem[] }>(`/api/claude/sessions/${id}`),
    enabled: !!id,
    refetchInterval: 2_500,
  });
}

export function useAgentFeeds(enabled = true) {
  return useQuery({
    queryKey: ["agents", "feeds"],
    queryFn: () => apiFetch<{ feeds: { id: string; name: string; createdAt: string; lastEventAt: string | null }[] }>("/api/claude/feeds"),
    select: (data) => data.feeds,
    enabled,
  });
}

export function useAgentFeedMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["agents", "feeds"] });
  return {
    create: useMutation({
      mutationFn: (name: string) => apiFetch<{ feed: { id: string; name: string; token: string } }>("/api/claude/feeds", { method: "POST", body: JSON.stringify({ name }) }),
      onSuccess: refresh,
    }),
    rotate: useMutation({ mutationFn: (id: string) => apiFetch<{ token: string }>(`/api/claude/feeds/${id}/token`, { method: "POST" }) }),
    remove: useMutation({ mutationFn: (id: string) => apiFetch<void>(`/api/claude/feeds/${id}`, { method: "DELETE" }), onSuccess: refresh }),
  };
}

export function useAgentCommands(sessionId: string | null) {
  return useQuery({
    queryKey: ["agents", "commands", sessionId],
    queryFn: () => apiFetch<{ commands: AgentCommandView[] }>(`/api/claude/sessions/${sessionId}/commands`),
    select: (data) => data.commands,
    enabled: !!sessionId,
    refetchInterval: 2_500,
  });
}

export function useAgentCommandMutations(sessionId: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["agents", "commands", sessionId] });
  return {
    send: useMutation({
      mutationFn: (text: string) => apiFetch<{ command: AgentCommandView }>(`/api/claude/sessions/${sessionId}/commands`, { method: "POST", body: JSON.stringify({ text }) }),
      onSuccess: refresh,
    }),
    cancel: useMutation({
      mutationFn: (commandId: string) => apiFetch<void>(`/api/claude/sessions/${sessionId}/commands/${commandId}`, { method: "DELETE" }),
      onSuccess: refresh,
    }),
  };
}
