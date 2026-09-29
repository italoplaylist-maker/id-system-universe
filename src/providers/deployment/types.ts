/**
 * Provider-agnostic domain types. The UI and application services only ever
 * see these — never a provider's raw API shape. Adding Docker/Vercel/Railway
 * later means writing a new folder under `providers/deployment/<name>` that
 * returns these same types; nothing above this layer changes.
 */

export type NormalizedApplicationStatus = "RUNNING" | "STOPPED" | "ERROR" | "UNKNOWN";

export interface ConnectionResult {
  ok: boolean;
  latencyMs: number;
  applicationCount?: number;
  error?: string;
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
  listApplications(): Promise<ProviderApplication[]>;
  getApplication(externalId: string): Promise<ProviderApplication>;
  getApplicationStatus(externalId: string): Promise<NormalizedApplicationStatus>;
  getApplicationLogs(externalId: string, options?: LogOptions): Promise<LogResult>;
  listDeployments(applicationExternalId: string): Promise<ProviderDeployment[]>;
  getDeployment(deploymentExternalId: string): Promise<ProviderDeployment>;
  startApplication(externalId: string): Promise<ActionResult>;
  stopApplication(externalId: string): Promise<ActionResult>;
  restartApplication(externalId: string): Promise<ActionResult>;
  redeployApplication(externalId: string, options?: { force?: boolean }): Promise<ActionResult>;
}
