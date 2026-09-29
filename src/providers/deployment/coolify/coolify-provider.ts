import type {
  ActionResult,
  ConnectionResult,
  DeploymentProvider,
  LogOptions,
  LogResult,
  NormalizedApplicationStatus,
  ProviderApplication,
  ProviderDeployment,
  ProviderProject,
  ProviderResourceType,
} from "../types";
import { CoolifyClient } from "./coolify-client";
import type { CoolifyProjectDetailRaw } from "./coolify-types";
import { mapApplication, mapApplicationStatus, mapDatabase, mapDeployment, mapLogs, mapService } from "./coolify-mapper";
import { ProviderError } from "@/lib/errors";

export class CoolifyProvider implements DeploymentProvider {
  private readonly client: CoolifyClient;

  constructor(baseUrl: string, token: string, providerName: string) {
    this.client = new CoolifyClient(baseUrl, token, providerName);
  }

  async testConnection(): Promise<ConnectionResult> {
    const start = performance.now();
    try {
      const applications = await this.client.listApplications();
      return { ok: true, latencyMs: Math.round(performance.now() - start), applicationCount: applications.length };
    } catch (error) {
      const message = error instanceof ProviderError ? error.message : "Connection failed.";
      return { ok: false, latencyMs: Math.round(performance.now() - start), error: message };
    }
  }

  /**
   * Walks every Project this Coolify instance has and resolves each one's
   * Environments — the real API nests Environment metadata under a Project,
   * but never the Applications/Services/Databases living in it (see
   * coolify-types.ts for why the earlier, unverified assumption was wrong).
   * Everything that actually consumes resource↔project membership (both
   * `listResources` and `listProjects` below) is built from this one walk,
   * matched by the numeric `environment_id` every resource carries.
   */
  private async fetchProjectEnvironments(): Promise<{
    envIdToUuid: Map<number, string>;
    projects: { externalId: string; name: string; environmentUuids: string[] }[];
  }> {
    const stubs = await this.client.listProjects();
    const details = await Promise.all(
      stubs.map(async (stub) => {
        try {
          return await this.client.getProject(stub.uuid);
        } catch {
          // One project failing to load (permissions, a stale uuid) shouldn't
          // abort resolution for every other project this instance has.
          return null;
        }
      }),
    );

    const resolved = details.map((detail, index): CoolifyProjectDetailRaw => detail ?? stubs[index]);

    const envIdToUuid = new Map<number, string>();
    const projects = resolved.map((project) => {
      const environments = project.environments ?? [];
      for (const env of environments) envIdToUuid.set(env.id, env.uuid);
      return { externalId: project.uuid, name: project.name, environmentUuids: environments.map((env) => env.uuid) };
    });

    return { envIdToUuid, projects };
  }

  async listResources(): Promise<ProviderApplication[]> {
    const [{ envIdToUuid }, applications, services, databases] = await Promise.all([
      this.fetchProjectEnvironments(),
      this.client.listApplications(),
      this.client.listServices(),
      this.client.listDatabases(),
    ]);

    const resolveEnvironment = (environmentId: number | undefined) => (environmentId === undefined ? undefined : envIdToUuid.get(environmentId));

    return [
      ...applications.map((raw) => mapApplication(raw, resolveEnvironment)),
      ...services.map((raw) => mapService(raw, resolveEnvironment)),
      ...databases.map((raw) => mapDatabase(raw, resolveEnvironment)),
    ];
  }

  async getApplicationStatus(externalId: string, resourceType: ProviderResourceType): Promise<NormalizedApplicationStatus> {
    if (resourceType === "SERVICE") return mapApplicationStatus((await this.client.getService(externalId)).status);
    if (resourceType === "DATABASE") return mapApplicationStatus((await this.client.getDatabase(externalId)).status);
    return mapApplicationStatus((await this.client.getApplication(externalId)).status);
  }

  async getApplicationLogs(externalId: string, resourceType: ProviderResourceType, options?: LogOptions): Promise<LogResult> {
    const raw =
      resourceType === "SERVICE"
        ? await this.client.getServiceLogs(externalId, options?.lines)
        : resourceType === "DATABASE"
          ? await this.client.getDatabaseLogs(externalId, options?.lines)
          : await this.client.getApplicationLogs(externalId, options?.lines);
    return mapLogs(raw);
  }

  async listDeployments(applicationExternalId: string): Promise<ProviderDeployment[]> {
    const raw = await this.client.listDeploymentsForApplication(applicationExternalId);
    return raw.map(mapDeployment);
  }

  async getDeployment(deploymentExternalId: string): Promise<ProviderDeployment> {
    const raw = await this.client.getDeployment(deploymentExternalId);
    return mapDeployment(raw);
  }

  async startApplication(externalId: string, resourceType: ProviderResourceType): Promise<ActionResult> {
    const response =
      resourceType === "SERVICE"
        ? await this.client.startService(externalId)
        : resourceType === "DATABASE"
          ? await this.client.startDatabase(externalId)
          : await this.client.startApplication(externalId);
    return { accepted: true, message: response.message };
  }

  async stopApplication(externalId: string, resourceType: ProviderResourceType): Promise<ActionResult> {
    const response =
      resourceType === "SERVICE"
        ? await this.client.stopService(externalId)
        : resourceType === "DATABASE"
          ? await this.client.stopDatabase(externalId)
          : await this.client.stopApplication(externalId);
    return { accepted: true, message: response.message };
  }

  async restartApplication(externalId: string, resourceType: ProviderResourceType): Promise<ActionResult> {
    const response =
      resourceType === "SERVICE"
        ? await this.client.restartService(externalId)
        : resourceType === "DATABASE"
          ? await this.client.restartDatabase(externalId)
          : await this.client.restartApplication(externalId);
    return { accepted: true, message: response.message };
  }

  async redeployApplication(externalId: string, options?: { force?: boolean }): Promise<ActionResult> {
    const response = await this.client.deploy(externalId, options?.force ?? false);
    const item = response.deployments?.[0];
    return { accepted: true, deploymentExternalId: item?.deployment_uuid, message: item?.message };
  }

  async listProjects(): Promise<ProviderProject[]> {
    const { projects } = await this.fetchProjectEnvironments();
    return projects.map((project) => ({ externalId: project.externalId, name: project.name, groupExternalIds: project.environmentUuids }));
  }
}
