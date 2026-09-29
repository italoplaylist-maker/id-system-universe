import type {
  CoolifyApplicationRaw,
  CoolifyDatabaseRaw,
  CoolifyDeploymentRaw,
  CoolifyLogsRaw,
  CoolifyServiceRaw,
} from "./coolify-types";
import type {
  DeploymentStatus,
  LogLine,
  LogResult,
  NormalizedApplicationStatus,
  ProviderApplication,
  ProviderDeployment,
} from "../types";

export function mapApplicationStatus(rawStatus: string | undefined | null): NormalizedApplicationStatus {
  if (!rawStatus) return "UNKNOWN";
  const [state, health] = rawStatus.toLowerCase().split(":");
  if (state === "running") return health === "unhealthy" ? "ERROR" : "RUNNING";
  if (state === "exited" || state === "stopped") return "STOPPED";
  if (state === "degraded") return "ERROR";
  return "UNKNOWN";
}

/** Coolify's own numeric Environment id, mapped ahead of time to that environment's external uuid — see CoolifyProvider. Undefined when the id couldn't be resolved (never blocks the resource from syncing, just leaves it unlinked to a Project). */
type EnvironmentIdResolver = (environmentId: number | undefined) => string | undefined;

export function mapApplication(raw: CoolifyApplicationRaw, resolveEnvironment: EnvironmentIdResolver): ProviderApplication {
  return {
    externalId: raw.uuid,
    name: raw.name,
    description: raw.description ?? undefined,
    status: mapApplicationStatus(raw.status),
    fqdn: raw.fqdn ?? undefined,
    repository: raw.git_repository ?? undefined,
    branch: raw.git_branch ?? undefined,
    resourceType: "APPLICATION",
    groupExternalId: resolveEnvironment(raw.environment_id),
  };
}

export function mapService(raw: CoolifyServiceRaw, resolveEnvironment: EnvironmentIdResolver): ProviderApplication {
  return {
    externalId: raw.uuid,
    name: raw.name,
    description: raw.description ?? undefined,
    status: mapApplicationStatus(raw.status),
    resourceType: "SERVICE",
    groupExternalId: resolveEnvironment(raw.environment_id),
  };
}

export function mapDatabase(raw: CoolifyDatabaseRaw, resolveEnvironment: EnvironmentIdResolver): ProviderApplication {
  return {
    externalId: raw.uuid,
    name: raw.name,
    description: raw.description ?? undefined,
    status: mapApplicationStatus(raw.status),
    resourceType: "DATABASE",
    groupExternalId: resolveEnvironment(raw.environment_id),
  };
}

const DEPLOYMENT_STATUS_MAP: Record<string, DeploymentStatus> = {
  queued: "QUEUED",
  in_progress: "RUNNING",
  running: "RUNNING",
  finished: "SUCCESS",
  success: "SUCCESS",
  failed: "FAILED",
  error: "FAILED",
  "cancelled-by-user": "CANCELLED",
  cancelled: "CANCELLED",
};

export function mapDeploymentStatus(rawStatus: string): DeploymentStatus {
  return DEPLOYMENT_STATUS_MAP[rawStatus.toLowerCase()] ?? "QUEUED";
}

export function mapDeployment(raw: CoolifyDeploymentRaw): ProviderDeployment {
  return {
    externalId: raw.deployment_uuid,
    applicationExternalId: raw.application_uuid ?? raw.application_id ?? "",
    status: mapDeploymentStatus(raw.status),
    commit: raw.commit ?? undefined,
    commitMessage: raw.commit_message ?? undefined,
    startedAt: raw.created_at,
    finishedAt: raw.status && DEPLOYMENT_STATUS_MAP[raw.status.toLowerCase()] && DEPLOYMENT_STATUS_MAP[raw.status.toLowerCase()] !== "RUNNING" && DEPLOYMENT_STATUS_MAP[raw.status.toLowerCase()] !== "QUEUED" ? raw.updated_at : undefined,
  };
}

const ERROR_PATTERN = /\b(error|panic|fatal|exception|fail(ed|ure)?)\b/i;
const WARN_PATTERN = /\b(warn(ing)?|deprecat\w*)\b/i;

function classifyLine(line: string): LogLine["level"] {
  if (ERROR_PATTERN.test(line)) return "ERROR";
  if (WARN_PATTERN.test(line)) return "WARN";
  return "INFO";
}

/**
 * Coolify returns logs as one opaque string. We only classify lines for
 * visual differentiation (INFO/WARN/ERROR) — the original text is preserved
 * verbatim, never rewritten.
 */
export function mapLogs(raw: CoolifyLogsRaw): LogResult {
  const lines = raw.logs
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => ({ raw: line, level: classifyLine(line) }));
  return { lines, supportsStreaming: false };
}
