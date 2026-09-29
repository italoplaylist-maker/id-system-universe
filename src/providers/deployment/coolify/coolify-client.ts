import { ProviderError } from "@/lib/errors";
import { buildProviderRequestUrl } from "@/server/security/ssrf";
import type {
  CoolifyActionResponse,
  CoolifyApplicationRaw,
  CoolifyDeployTriggerResponse,
  CoolifyDeploymentRaw,
  CoolifyLogsRaw,
  CoolifyProjectDetailRaw,
  CoolifyProjectRaw,
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
    return this.request(ENDPOINTS.applicationStart(uuid));
  }

  async stopApplication(uuid: string): Promise<CoolifyActionResponse> {
    return this.request(ENDPOINTS.applicationStop(uuid));
  }

  async restartApplication(uuid: string): Promise<CoolifyActionResponse> {
    return this.request(ENDPOINTS.applicationRestart(uuid));
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
}
