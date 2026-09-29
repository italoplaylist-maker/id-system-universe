/**
 * Shapes returned by the API to the browser. Distinct from the Prisma models
 * (which the client never sees) and from the provider-layer types (which
 * never leave the server) — this is the one contract the UI depends on.
 */

export type UniverseApplicationStatus = "RUNNING" | "STOPPED" | "DEPLOYING" | "ERROR" | "UNKNOWN";
export type UniverseResourceType = "APPLICATION" | "SERVICE" | "DATABASE";

/** A resource: one deployable unit inside a Project (Web, API, Database, ...). */
export interface UniverseApplication {
  id: string;
  externalId: string;
  providerId: string;
  providerType: string;
  providerName: string;
  providerColor: string;
  projectId: string | null;
  projectName: string | null;
  projectAccent: string | null;
  resourceType: UniverseResourceType;
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

export type UniverseProjectHealth = "HEALTHY" | "DEGRADED" | "DEPLOYING" | "OFFLINE" | "UNKNOWN";

export interface UniverseProject {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  accent: string;
  enabled: boolean;
  archivedAt: string | null;
  health: UniverseProjectHealth;
  resourceCount: number;
  providerCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface UniverseProjectDetail extends UniverseProject {
  resources: UniverseApplication[];
}

export interface ProjectSuggestion {
  /** Common name "stem" the unassigned resources share, e.g. "italoc". */
  stem: string;
  resourceIds: string[];
  resourceNames: string[];
  /** Set only when an existing project's name/slug matches the stem exactly. */
  matchedProjectId: string | null;
  matchedProjectName: string | null;
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
  projectCount: number;
}
