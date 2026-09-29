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
  project: { name: string } | null;
}

export interface UniverseEventRow {
  id: string;
  type: string;
  message: string;
  applicationName: string | null;
  projectName: string | null;
  createdAt: string;
}

export function useActivity(limit = 50, projectId?: string) {
  return useQuery({
    queryKey: ["activity", limit, projectId],
    queryFn: () =>
      apiFetch<{ auditEvents: AuditEventRow[]; universeEvents: UniverseEventRow[] }>(
        `/api/activity?limit=${limit}${projectId ? `&projectId=${projectId}` : ""}`,
      ),
    refetchInterval: 15_000,
  });
}
