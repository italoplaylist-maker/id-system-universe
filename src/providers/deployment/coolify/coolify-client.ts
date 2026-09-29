import { ProviderError } from "@/lib/errors";
import { buildProviderRequestUrl } from "@/server/security/ssrf";
import type {
  CoolifyActionResponse,
  CoolifyApplicationRaw,
  CoolifyDatabaseRaw,
  CoolifyDeployTriggerResponse,
  CoolifyDeploymentRaw,
  CoolifyLogsRaw,
  CoolifyProjectDetailRaw,
  CoolifyProjectRaw,
  CoolifyServiceRaw,
  CoolifyVersionResponse,
} from "./coolify-types";

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Every Coolify REST endpoint this product calls lives here, and only here —
 * nothing else in the codebase knows these paths. If your Coolify version
 * uses different routes, this is the one file to change.
 */
const ENDPOINTS = {
  version: () => "/api/v1/version",
  applications: () => "/api/v1/applications",
  application: (uuid: string) => `/api/v1/applications/${encodeURIComponent(uuid)}`,
  applicationLogs: (uuid: string) => `/api/v1/applications/${encodeURIComponent(uuid)}/logs`,
  applicationStart: (uuid: string) => `/api/v1/applications/${encodeURIComponent(uuid)}/start`,
  applicationStop: (uuid: string) => `/api/v1/applications/${encodeURIComponent(uuid)}/stop`,
  applicationRestart: (uuid: string) => `/api/v1/applications/${encodeURIComponent(uuid)}/restart`,
  deploy: () => "/api/v1/deploy",
  deployments: () => "/api/v1/deployments",
  deployment: (uuid: string) => `/api/v1/deployments/${encodeURIComponent(uuid)}`,
  projects: () => "/api/v1/projects",
  project: (uuid: string) => `/api/v1/projects/${encodeURIComponent(uuid)}`,
  services: () => "/api/v1/services",
  service: (uuid: string) => `/api/v1/services/${encodeURIComponent(uuid)}`,
  serviceStart: (uuid: string) => `/api/v1/services/${encodeURIComponent(uuid)}/start`,
  serviceStop: (uuid: string) => `/api/v1/services/${encodeURIComponent(uuid)}/stop`,
  serviceRestart: (uuid: string) => `/api/v1/services/${encodeURIComponent(uuid)}/restart`,
  serviceLogs: (uuid: string) => `/api/v1/services/${encodeURIComponent(uuid)}/logs`,
  databases: () => "/api/v1/databases",
  database: (uuid: string) => `/api/v1/databases/${encodeURIComponent(uuid)}`,
  databaseStart: (uuid: string) => `/api/v1/databases/${encodeURIComponent(uuid)}/start`,
  databaseStop: (uuid: string) => `/api/v1/databases/${encodeURIComponent(uuid)}/stop`,
  databaseRestart: (uuid: string) => `/api/v1/databases/${encodeURIComponent(uuid)}/restart`,
  databaseLogs: (uuid: string) => `/api/v1/databases/${encodeURIComponent(uuid)}/logs`,
} as const;

interface RequestOptions {
  method?: "GET" | "POST";
  query?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
}

export class CoolifyClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly providerName: string,
  ) {}

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = buildProviderRequestUrl(this.baseUrl, path);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? "GET",
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ProviderError(
          `${this.providerName} did not respond within ${(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000} seconds.`,
          this.providerName,
          504,
        );
      }
      throw new ProviderError(`${this.providerName} is unreachable.`, this.providerName, 502);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw this.normalizeErrorResponse(response);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private normalizeErrorResponse(response: Response): ProviderError {
    switch (response.status) {
      case 401:
        return new ProviderError(`${this.providerName} returned an authentication error. Check the API token.`, this.providerName, 401);
      case 403:
        return new ProviderError(`${this.providerName} denied access to this resource.`, this.providerName, 403);
      case 404:
        return new ProviderError(`${this.providerName} could not find the requested resource.`, this.providerName, 404);
      case 409:
        return new ProviderError(`${this.providerName} reports a conflicting state for this resource.`, this.providerName, 409);
      case 422:
        return new ProviderError(`${this.providerName} rejected the request (invalid parameters).`, this.providerName, 422);
      case 429:
        return new ProviderError(`${this.providerName} is rate limiting requests. Try again shortly.`, this.providerName, 429);
      default:
        if (response.status >= 500) {
          return new ProviderError(`${this.providerName} is currently unavailable.`, this.providerName, 502);
        }
        return new ProviderError(`${this.providerName} returned an unexpected error.`, this.providerName, 502);
    }
  }

  async getVersion(): Promise<CoolifyVersionResponse> {
    return this.request(ENDPOINTS.version());
  }

  async listApplications(): Promise<CoolifyApplicationRaw[]> {
    return this.request(ENDPOINTS.applications());
  }

  async getApplication(uuid: string): Promise<CoolifyApplicationRaw> {
    return this.request(ENDPOINTS.application(uuid));
  }

  async getApplicationLogs(uuid: string, lines = 500): Promise<CoolifyLogsRaw> {
    return this.request(ENDPOINTS.applicationLogs(uuid), { query: { lines } });
  }

  async startApplication(uuid: string): Promise<CoolifyActionResponse> {
    // Coolify registers a separate GET route on this same path that only
    // responds "POST required" (routes/api.php) — sending GET here (the
    // bug prior to this fix) silently hit that guard instead of the real
    // action every single time, against a real instance. The bundled fake
    // Coolify test fixture never caught it because it was written to match
    // the same wrong assumption.
    return this.request(ENDPOINTS.applicationStart(uuid), { method: "POST" });
  }

  async stopApplication(uuid: string): Promise<CoolifyActionResponse> {
    return this.request(ENDPOINTS.applicationStop(uuid), { method: "POST" });
  }

  async restartApplication(uuid: string): Promise<CoolifyActionResponse> {
    return this.request(ENDPOINTS.applicationRestart(uuid), { method: "POST" });
  }

  async deploy(uuid: string, force: boolean): Promise<CoolifyDeployTriggerResponse> {
    return this.request(ENDPOINTS.deploy(), { method: "POST", query: { uuid, force } });
  }

  async listDeploymentsForApplication(applicationUuid: string): Promise<CoolifyDeploymentRaw[]> {
    // Best-effort: filters the global deployment list by application uuid.
    // If your Coolify version exposes a dedicated per-application endpoint,
    // switch this one line rather than anything upstream of it.
    const all = await this.request<CoolifyDeploymentRaw[]>(ENDPOINTS.deployments());
    return all.filter(
      (deployment) => deployment.application_uuid === applicationUuid || deployment.application_id === applicationUuid,
    );
  }

  async getDeployment(uuid: string): Promise<CoolifyDeploymentRaw> {
    return this.request(ENDPOINTS.deployment(uuid));
  }

  async listProjects(): Promise<CoolifyProjectRaw[]> {
    return this.request(ENDPOINTS.projects());
  }

  async getProject(uuid: string): Promise<CoolifyProjectDetailRaw> {
    return this.request(ENDPOINTS.project(uuid));
  }

  async listServices(): Promise<CoolifyServiceRaw[]> {
    return this.request(ENDPOINTS.services());
  }

  async getService(uuid: string): Promise<CoolifyServiceRaw> {
    return this.request(ENDPOINTS.service(uuid));
  }

  async startService(uuid: string): Promise<CoolifyActionResponse> {
    return this.request(ENDPOINTS.serviceStart(uuid), { method: "POST" });
  }

  async stopService(uuid: string): Promise<CoolifyActionResponse> {
    return this.request(ENDPOINTS.serviceStop(uuid), { method: "POST" });
  }

  async restartService(uuid: string): Promise<CoolifyActionResponse> {
    return this.request(ENDPOINTS.serviceRestart(uuid), { method: "POST" });
  }

  async getServiceLogs(uuid: string, lines = 500): Promise<CoolifyLogsRaw> {
    return this.request(ENDPOINTS.serviceLogs(uuid), { query: { lines } });
  }

  async listDatabases(): Promise<CoolifyDatabaseRaw[]> {
    return this.request(ENDPOINTS.databases());
  }

  async getDatabase(uuid: string): Promise<CoolifyDatabaseRaw> {
    return this.request(ENDPOINTS.database(uuid));
  }

  async startDatabase(uuid: string): Promise<CoolifyActionResponse> {
    return this.request(ENDPOINTS.databaseStart(uuid), { method: "POST" });
  }

  async stopDatabase(uuid: string): Promise<CoolifyActionResponse> {
    return this.request(ENDPOINTS.databaseStop(uuid), { method: "POST" });
  }

  async restartDatabase(uuid: string): Promise<CoolifyActionResponse> {
    return this.request(ENDPOINTS.databaseRestart(uuid), { method: "POST" });
  }

  async getDatabaseLogs(uuid: string, lines = 500): Promise<CoolifyLogsRaw> {
    return this.request(ENDPOINTS.databaseLogs(uuid), { query: { lines } });
  }
}
