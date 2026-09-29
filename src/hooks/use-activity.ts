"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";

export interface AuditEventRow {
  id: string;
  action: string;
  status: string;
  metadata: unknown;
  createdAt: string;
  user: { email: string } | null;
  provider: { name: string } | null;
  application: { name: string } | null;
}

export interface UniverseEventRow {
  id: string;
  type: string;
  message: string;
  applicationName: string | null;
  createdAt: string;
}

export function useActivity(limit = 50) {
  return useQuery({
    queryKey: ["activity", limit],
    queryFn: () => apiFetch<{ auditEvents: AuditEventRow[]; universeEvents: UniverseEventRow[] }>(`/api/activity?limit=${limit}`),
    refetchInterval: 15_000,
  });
}
