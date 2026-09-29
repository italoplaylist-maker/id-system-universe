/**
 * Provider-agnostic domain types. The UI and application services only ever
 * see these — never a provider's raw API shape. Adding Docker/Vercel/Railway
 * later means writing a new folder under `providers/deployment/<name>` that
 * returns these same types; nothing above this layer changes.
 */

export type NormalizedApplicationStatus = "RUNNING" | "STOPPED" | "ERROR" | "UNKNOWN";

/** What kind of deployable unit this is — mirrors the Prisma `ResourceType` enum. Only "APPLICATION" supports redeploy/deployments/git info; all three support start/stop/restart/logs. */
export type ProviderResourceType = "APPLICATION" | "SERVICE" | "DATABASE";

export interface ConnectionResult {
  ok: boolean;
  latencyMs: number;
  applicationCount?: number;
  error?: string;
}

export interface ProviderProject {
  /** Provider-native identifier (e.g. Coolify project UUID). Unique within the provider only. */
  externalId: string;
  name: string;
  /** Every resource's `groupExternalId` (see ProviderApplication) that this provider considers part of the project. */
  groupExternalIds: string[];
}

export interface ProviderApplication {
  /** Provider-native identifier (e.g. Coolify UUID). Unique within the provider only. */
  externalId: string;
  name: string;
  description?: string;
  status: NormalizedApplicationStatus;
  fqdn?: string;
  repository?: string;
  branch?: string;
  resourceType: ProviderResourceType;
  /** The provider's own grouping key this resource lives in (Coolify: the Environment UUID) — matched against ProviderProject.groupExternalIds to auto-link. Undefined for a provider without this concept. */
  groupExternalId?: string;
}

export interface LogOptions {
  lines?: number;
  since?: string;
}

export interface LogLine {
  raw: string;
  level: "INFO" | "WARN" | "ERROR";
  timestamp?: string;
}

export interface LogResult {
  lines: LogLine[];
  /** True when the provider is known to support live/streamed log tailing. */
  supportsStreaming: boolean;
}

export type DeploymentStatus = "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED";

export interface ProviderDeployment {
  externalId: string;
  applicationExternalId: string;
  status: DeploymentStatus;
  commit?: string;
  commitMessage?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface ActionResult {
  accepted: boolean;
  /** Present when the action kicked off an async deployment we can track. */
  deploymentExternalId?: string;
  message?: string;
}

/**
 * Implemented once per infrastructure type (Coolify today). The rest of the
 * application depends only on this interface, never on a concrete provider.
 */
export interface DeploymentProvider {
  testConnection(): Promise<ConnectionResult>;
  /** Every application, service, and database this provider's team/account owns — not applications only, despite the historical name of this concept elsewhere. */
  listResources(): Promise<ProviderApplication[]>;
  /**
   * The provider's own project/grouping concept, if it has one — used to
   * auto-link synced resources to an ID System `Project` that matches by
   * name, so admins never have to manually recreate a grouping the
   * infrastructure already knows. Providers without a project concept can
   * resolve to an empty array.
   */
  listProjects(): Promise<ProviderProject[]>;
  getApplicationStatus(externalId: string, resourceType: ProviderResourceType): Promise<NormalizedApplicationStatus>;
  getApplicationLogs(externalId: string, resourceType: ProviderResourceType, options?: LogOptions): Promise<LogResult>;
  /** Applications only — services/databases don't have a git-based deploy history. */
  listDeployments(applicationExternalId: string): Promise<ProviderDeployment[]>;
  getDeployment(deploymentExternalId: string): Promise<ProviderDeployment>;
  startApplication(externalId: string, resourceType: ProviderResourceType): Promise<ActionResult>;
  stopApplication(externalId: string, resourceType: ProviderResourceType): Promise<ActionResult>;
  restartApplication(externalId: string, resourceType: ProviderResourceType): Promise<ActionResult>;
  /** Applications only — services/databases are redeployed by restarting them (see startApplication). */
  redeployApplication(externalId: string, options?: { force?: boolean }): Promise<ActionResult>;
}
