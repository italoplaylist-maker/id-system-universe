/**
 * Shapes returned by the API to the browser. Distinct from the Prisma models
 * (which the client never sees) and from the provider-layer types (which
 * never leave the server) — this is the one contract the UI depends on.
 */

export type UniverseApplicationStatus = "RUNNING" | "STOPPED" | "DEPLOYING" | "ERROR" | "UNKNOWN";

export interface UniverseApplication {
  id: string;
  externalId: string;
  providerId: string;
  providerType: string;
  providerName: string;
  providerColor: string;
  name: string;
  description: string | null;
  status: UniverseApplicationStatus;
  fqdn: string | null;
  repository: string | null;
  branch: string | null;
  lastDeployedAt: string | null;
  lastSyncedAt: string;
  pendingOperation: string | null;
}

export interface UniverseDeployment {
  id: string;
  externalId: string;
  status: "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED";
  commit: string | null;
  commitMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface UniverseLogLine {
  raw: string;
  level: "INFO" | "WARN" | "ERROR";
}

export interface UniverseProviderSummary {
  id: string;
  type: string;
  name: string;
  baseUrl: string;
  maskedToken: string;
  enabled: boolean;
  color: string;
  health: "ONLINE" | "DEGRADED" | "OFFLINE" | "UNKNOWN";
  latencyMs: number | null;
  lastCheckAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  applicationCount: number;
}
