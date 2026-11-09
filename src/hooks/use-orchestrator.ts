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
    queryFn: () => apiFetch<{ task: TaskView; events: TaskEventView[]; approval: { id: string; tool: string; detail: string } | null; attachments: Array<{ id: string; name: string; mime: string; size: number; kind: "image" | "file" }> }>(`/api/orchestrator/tasks/${taskId}`),
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

export interface AvailableModelView {
  value: string;
  displayName: string;
  description: string | null;
  resolvedModel: string | null;
  efforts: string[];
}

/** Modelos que o Claude oferece agora para a conta conectada (consulta real). */
export function useAvailableModels(enabled = true) {
  return useQuery({
    queryKey: [...KEY, "models"],
    queryFn: () => apiFetch<{ models: AvailableModelView[]; error: string | null }>("/api/orchestrator/models"),
    enabled,
    staleTime: 60_000,
  });
}

export function useOrchestratorSettings(enabled = true) {
  return useQuery({
    queryKey: [...KEY, "settings"],
    queryFn: () => apiFetch<{ settings: { maxConcurrent: number; autoApprove: boolean } }>("/api/orchestrator/settings"),
    select: (d) => d.settings,
    enabled,
  });
}

export interface AgentToolsView {
  skills: { name: string; description: string | null; content: string }[];
  claudeMd: string;
  mcp: { id: string; name: string; type: string; command: string | null; args: string[]; url: string | null; secretKeys: string[]; enabled: boolean }[];
  packs: Array<{ id: string; name: string; description: string; version: string; license: string; skillsInstalled: boolean; mcpInstalled: boolean; mcpAvailable: boolean }>;
  plugins: { installed: { id?: string; name?: string; version?: string; enabled?: boolean }[]; marketplaces: { name?: string }[] };
}

export function useAgentTools(enabled: boolean) {
  return useQuery({ queryKey: [...KEY, "tools"], queryFn: () => apiFetch<AgentToolsView>("/api/orchestrator/tools"), enabled });
}

export function useAgentToolsMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [...KEY, "tools"] });
  const post = (path: string, method: string, body?: unknown) => apiFetch<{ output?: string }>(`/api/orchestrator/tools/${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  return {
    saveSkill: useMutation({ mutationFn: (v: { name: string; content: string }) => post("skills", "POST", v), onSettled: refresh }),
    deleteSkill: useMutation({ mutationFn: (name: string) => post(`skills/${encodeURIComponent(name)}`, "DELETE"), onSettled: refresh }),
    saveClaudeMd: useMutation({ mutationFn: (content: string) => post("claude-md", "PUT", { content }), onSettled: refresh }),
    createMcp: useMutation({ mutationFn: (v: unknown) => post("mcp", "POST", v), onSettled: refresh }),
    toggleMcp: useMutation({ mutationFn: (v: { id: string; enabled: boolean }) => post(`mcp/${v.id}`, "PATCH", { enabled: v.enabled }), onSettled: refresh }),
    deleteMcp: useMutation({ mutationFn: (id: string) => post(`mcp/${id}`, "DELETE"), onSettled: refresh }),
    installPack: useMutation({ mutationFn: (v: { id: string; withMcp: boolean }) => post("packs", "POST", v), onSettled: refresh }),
    plugin: useMutation({ mutationFn: (v: { action: string; value: string }) => post("plugins", "POST", v), onSettled: refresh }),
  };
}

export interface GitStatusView {
  hasRepo: boolean;
  repo: string | null;
  baseBranch: string | null;
  workspaceExists: boolean;
  branch: string | null;
  changedFiles: number;
  unpushedCommits: number;
  missingPermissions: string[];
  missingForMerge: string[];
  permissionsChecked: boolean;
  permissionsSeen: { installationId: string; account: string; contents: string; pullRequests: string; checks: string; statuses: string; settingsUrl: string } | null;
  repoRef?: string;
  pullRequests: Array<{ id: string; number: number; url: string; title: string; status: string; branch: string; repo?: string }>;
}

export function useAgentGit(agentId: string | null, repo: string = "primary") {
  return useQuery({
    queryKey: [...KEY, "git", agentId, repo],
    queryFn: () => apiFetch<GitStatusView>(`/api/orchestrator/agents/${agentId}/git?permissions=1&repo=${encodeURIComponent(repo)}`),
    enabled: !!agentId,
    refetchInterval: 15_000,
  });
}

export function useOrchestratorMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });
  return {
    /** A chave de idempotência é gerada pelo chamador UMA vez por comando: reenviar a mesma chave nunca duplica. */
    submit: useMutation({
      mutationFn: ({ agentId, prompt, idempotencyKey, attachmentIds }: { agentId: string; prompt: string; idempotencyKey: string; attachmentIds?: string[] }) =>
        apiFetch<{ task: TaskView; duplicate: boolean }>(`/api/orchestrator/agents/${agentId}/tasks`, { method: "POST", body: JSON.stringify({ prompt, idempotencyKey, attachmentIds }) }),
      onSettled: refresh,
    }),
    cancel: useMutation({ mutationFn: (taskId: string) => apiFetch<{ status: string }>(`/api/orchestrator/tasks/${taskId}/cancel`, { method: "POST" }), onSettled: refresh }),
    decide: useMutation({
      mutationFn: ({ id, decision }: { id: string; decision: "allow" | "deny" }) => apiFetch(`/api/orchestrator/approvals/${id}`, { method: "POST", body: JSON.stringify({ decision }) }),
      onSettled: refresh,
    }),
    createAgent: useMutation({
      mutationFn: (input: { name: string; specialty?: string; cwd: string; model?: string; permissionMode?: string; effort?: string; allowedTools?: string[]; disallowedTools?: string[] }) =>
        apiFetch<{ agent: { id: string } }>("/api/orchestrator/agents", { method: "POST", body: JSON.stringify(input) }),
      onSettled: refresh,
    }),
    updateAgent: useMutation({
      mutationFn: ({ id, ...input }: { id: string; name?: string; specialty?: string; cwd?: string; model?: string; permissionMode?: string; effort?: string | null; allowedTools?: string[]; disallowedTools?: string[]; paused?: boolean; githubRepositoryId?: string | null; githubBranch?: string | null }) =>
        apiFetch<{ agent: { prepare?: { ok: boolean; message: string } } }>(`/api/orchestrator/agents/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
      onSettled: refresh,
    }),
    archiveAgent: useMutation({ mutationFn: (id: string) => apiFetch(`/api/orchestrator/agents/${id}`, { method: "DELETE" }), onSettled: refresh }),
    startLogin: useMutation({ mutationFn: () => apiFetch<{ url: string }>("/api/orchestrator/auth/login", { method: "POST" }) }),
    submitLoginCode: useMutation({ mutationFn: (code: string) => apiFetch("/api/orchestrator/auth/code", { method: "POST", body: JSON.stringify({ code }) }), onSettled: refresh }),
    logout: useMutation({ mutationFn: () => apiFetch("/api/orchestrator/auth/logout", { method: "POST" }), onSettled: refresh }),
    publish: useMutation({
      mutationFn: (v: { agentId: string; title?: string; repo?: string }) => apiFetch<{ branch: string; pullRequest: { number: number; url: string }; committed: boolean }>(`/api/orchestrator/agents/${v.agentId}/git/publish`, { method: "POST", body: JSON.stringify({ title: v.title, repo: v.repo && v.repo !== "primary" ? v.repo : undefined }) }),
      onSettled: refresh,
    }),
    mergePr: useMutation({
      mutationFn: (prId: string) => apiFetch<{ merged: boolean; number: number; cleanup: { removed: boolean; reason?: string } }>(`/api/orchestrator/pull-requests/${prId}/merge`, { method: "POST" }),
      onSettled: refresh,
    }),
    cleanup: useMutation({
      mutationFn: (v: string | { agentId: string; repo?: string }) => {
        const agentId = typeof v === "string" ? v : v.agentId;
        const repo = typeof v === "string" ? undefined : v.repo;
        return apiFetch<{ removed: boolean; reason?: string }>(`/api/orchestrator/agents/${agentId}/git/cleanup${repo && repo !== "primary" ? `?repo=${encodeURIComponent(repo)}` : ""}`, { method: "POST" });
      },
      onSettled: refresh,
    }),
    setConcurrency: useMutation({
      mutationFn: (patch: number | { maxConcurrent?: number; autoApprove?: boolean }) => apiFetch("/api/orchestrator/settings", { method: "PATCH", body: JSON.stringify(typeof patch === "number" ? { maxConcurrent: patch } : patch) }),
      onSettled: refresh,
    }),
  };
}

export interface StorageReportView {
  workspaces: { path: string; bytes: number; agents: Array<{ agentId: string; name: string; bytes: number; heavyBytes: number; idleHours: number | null; busy: boolean }>; orphanBytes: number };
  claude: { path: string; bytes: number; transcriptsBytes: number };
  attachments: { bytes: number };
  database: { taskEvents: number; universeEvents: number; syncEvents: number };
  memory: { rssMB: number; heapUsedMB: number };
  totalBytes: number;
}

/** Uso de disco/memória do servidor. Só mede quando o painel pede (percorrer pastas custa I/O). */
export function useStorageReport(enabled: boolean) {
  return useQuery({ queryKey: [...KEY, "storage"], queryFn: () => apiFetch<{ report: StorageReportView }>("/api/orchestrator/storage"), enabled, staleTime: 30_000 });
}

export function useCleanStorage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ result: { freedBytes: number; actions: string[] }; report: StorageReportView }>("/api/orchestrator/storage", { method: "POST" }),
    onSuccess: (data) => queryClient.setQueryData([...KEY, "storage"], { report: data.report }),
  });
}

export interface GithubRepoOption {
  id: string;
  fullName: string;
  defaultBranch: string | null;
  isPrivate: boolean;
}

/** Repositórios disponíveis (os que o GitHub App enxerga). */
export function useGithubRepos(enabled: boolean) {
  return useQuery({ queryKey: [...KEY, "github-repos"], queryFn: () => apiFetch<{ repositories: GithubRepoOption[]; installations: number }>("/api/orchestrator/github-repos"), enabled, staleTime: 30_000 });
}

export function useRefreshGithubRepos() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ repositories: GithubRepoOption[]; installations: number }>("/api/orchestrator/github-repos", { method: "POST" }),
    onSuccess: (data) => queryClient.setQueryData([...KEY, "github-repos"], data),
  });
}

export interface AgentReposView {
  primary: { fullName: string; branch: string | null; source: "agent" | "project" } | null;
  extras: Array<{ id: string; fullName: string; dir: string; branch: string | null }>;
}

export function useAgentRepos(agentId: string | null) {
  return useQuery({ queryKey: [...KEY, "repos", agentId], queryFn: () => apiFetch<AgentReposView>(`/api/orchestrator/agents/${agentId}/repos`), enabled: !!agentId });
}

export function useExtraRepoMutations() {
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: KEY });
  return {
    add: useMutation({
      mutationFn: (v: { agentId: string; githubRepositoryId: string; branch?: string | null; applyToAll?: boolean }) => apiFetch<{ added: number; message: string }>(`/api/orchestrator/agents/${v.agentId}/repos`, { method: "POST", body: JSON.stringify({ githubRepositoryId: v.githubRepositoryId, branch: v.branch || null, applyToAll: v.applyToAll }) }),
      onSettled: refresh,
    }),
    remove: useMutation({
      mutationFn: (v: { agentId: string; extraId: string }) => apiFetch<{ cleanup: { removed: boolean; reason?: string } }>(`/api/orchestrator/agents/${v.agentId}/repos?extraId=${encodeURIComponent(v.extraId)}`, { method: "DELETE" }),
      onSettled: refresh,
    }),
  };
}

/** Uso do plano do Claude + tokens dos agentes (mostrado na tela do núcleo do escritório). */
export function useClaudeUsage(enabled = true) {
  return useQuery({
    queryKey: [...KEY, "usage"],
    queryFn: () => apiFetch<import("@/lib/claude-usage").ClaudeUsageView>("/api/orchestrator/usage"),
    enabled,
    staleTime: 60_000,
    refetchInterval: 90_000,
  });
}
