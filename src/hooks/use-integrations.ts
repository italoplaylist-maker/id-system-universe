"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { IntegrationCard } from "@/server/integrations/overview";
import type { GitHubConfigStatus, GitHubInstallationSummary } from "@/server/github/github-service";
import type { WhatsAppSettingsView } from "@/server/whatsapp/whatsapp-config";

export function useIntegrations() {
  return useQuery({
    queryKey: ["integrations"],
    queryFn: () => apiFetch<{ integrations: IntegrationCard[] }>("/api/integrations"),
    select: (data) => data.integrations,
    refetchInterval: 30_000,
  });
}

export function useGitHubIntegration() {
  return useQuery({
    queryKey: ["integrations", "github"],
    queryFn: () => apiFetch<{ config: GitHubConfigStatus; installations: GitHubInstallationSummary[] }>("/api/integrations/github"),
  });
}

function useInvalidateIntegrations() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["integrations"] });
}

export function useUpdateGitHubConfig() {
  const invalidate = useInvalidateIntegrations();
  return useMutation({
    mutationFn: (input: { appId?: string; appSlug?: string; privateKey?: string; webhookSecret?: string }) =>
      apiFetch("/api/integrations/github", { method: "PUT", body: JSON.stringify(input) }),
    onSuccess: invalidate,
  });
}

export function useConnectGitHub() {
  return useMutation({ mutationFn: () => apiFetch<{ url: string }>("/api/integrations/github/connect", { method: "POST" }) });
}

export function useSyncGitHub() {
  const invalidate = useInvalidateIntegrations();
  return useMutation({ mutationFn: () => apiFetch("/api/integrations/github/sync", { method: "POST" }), onSuccess: invalidate });
}

export function useRemoveGitHubInstallation() {
  const invalidate = useInvalidateIntegrations();
  return useMutation({ mutationFn: (id: string) => apiFetch(`/api/integrations/github/installations/${id}`, { method: "DELETE" }), onSuccess: invalidate });
}

export function useWhatsAppConfig() {
  return useQuery({
    queryKey: ["integrations", "whatsapp"],
    queryFn: () => apiFetch<{ config: WhatsAppSettingsView }>("/api/integrations/whatsapp"),
    select: (data) => data.config,
  });
}

export function useUpdateWhatsApp() {
  const invalidate = useInvalidateIntegrations();
  return useMutation({
    mutationFn: (input: { baseUrl?: string; instance?: string; apiKey?: string; timezone?: string; windowStart?: string; windowEnd?: string }) =>
      apiFetch("/api/integrations/whatsapp", { method: "PUT", body: JSON.stringify(input) }),
    onSuccess: invalidate,
  });
}

export function useTestWhatsApp() {
  return useMutation({ mutationFn: () => apiFetch<{ status: { connected: boolean; detail?: string } }>("/api/integrations/whatsapp/test", { method: "POST" }) });
}
