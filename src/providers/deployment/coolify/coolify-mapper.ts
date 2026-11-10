import { classifyLogLine as classifyLine } from "@/lib/error-logs";
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

/**
 * Log de um deploy do Coolify. Vem como JSON (lista de entradas {output, timestamp, hidden}) ou como texto puro;
 * as entradas "hidden" são comandos internos e ficam de fora. O texto original é preservado, só classificado.
 */
export function mapDeploymentLogs(rawLogs: string | null | undefined): LogLine[] {
  if (!rawLogs) return [];
  type Entry = { output?: unknown; timestamp?: unknown; hidden?: unknown };
  let entries: Entry[] | null = null;
  try {
    const parsed: unknown = JSON.parse(rawLogs);
    if (Array.isArray(parsed)) entries = parsed as Entry[];
  } catch {
    entries = null;
  }
  if (!entries) return rawLogs.split("\n").filter((l) => l.length > 0).map((l) => ({ raw: l, level: classifyLine(l) }));
  const lines: LogLine[] = [];
  for (const e of entries) {
    if (e.hidden === true || typeof e.output !== "string") continue;
    const timestamp = typeof e.timestamp === "string" ? e.timestamp : undefined;
    for (const line of e.output.split("\n")) if (line.length > 0) lines.push({ raw: line, level: classifyLine(line), timestamp });
  }
  return lines;
}

export const HIDDEN_LOGS_NOTE =
  "O Coolify não enviou o log deste deploy. Quase sempre é porque o token de API do Universe não tem a permissão de ver dados sensíveis (read:sensitive). No Coolify: Keys & Tokens → API tokens → crie um token com a permissão read:sensitive e troque o token em Configurações → Infraestrutura do Universe.";
export const EMPTY_LOGS_NOTE = "O Coolify devolveu o log deste deploy vazio (ele pode não ter gerado saída ainda, ou já foi limpo).";
export const ONLY_INTERNAL_LOGS_NOTE = "O Coolify enviou o log, mas só com comandos internos, sem saída visível.";

/** Log do deploy + o MOTIVO quando não há linhas: campo `logs` ausente (token sem permissão), vazio, ou só comandos internos. */
export function parseDeploymentLogs(raw: Pick<CoolifyDeploymentRaw, "logs">): { lines: LogLine[]; note: string | null } {
  if (raw.logs === undefined) return { lines: [], note: HIDDEN_LOGS_NOTE };
  if (raw.logs === null || raw.logs === "") return { lines: [], note: EMPTY_LOGS_NOTE };
  const lines = mapDeploymentLogs(raw.logs);
  return { lines, note: lines.length === 0 ? ONLY_INTERNAL_LOGS_NOTE : null };
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
