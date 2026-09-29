import type {
  ActionResult,
  ConnectionResult,
  DeploymentProvider,
  LogOptions,
  LogResult,
  NormalizedApplicationStatus,
  ProviderApplication,
  ProviderDeployment,
} from "../types";
import { CoolifyClient } from "./coolify-client";
import { mapApplication, mapApplicationStatus, mapDeployment, mapLogs } from "./coolify-mapper";
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

  async listApplications(): Promise<ProviderApplication[]> {
    const raw = await this.client.listApplications();
    return raw.map(mapApplication);
  }

  async getApplication(externalId: string): Promise<ProviderApplication> {
    const raw = await this.client.getApplication(externalId);
    return mapApplication(raw);
  }

  async getApplicationStatus(externalId: string): Promise<NormalizedApplicationStatus> {
    const raw = await this.client.getApplication(externalId);
    return mapApplicationStatus(raw.status);
  }

  async getApplicationLogs(externalId: string, options?: LogOptions): Promise<LogResult> {
    const raw = await this.client.getApplicationLogs(externalId, options?.lines);
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

  async startApplication(externalId: string): Promise<ActionResult> {
    const response = await this.client.startApplication(externalId);
    return { accepted: true, message: response.message };
  }

  async stopApplication(externalId: string): Promise<ActionResult> {
    const response = await this.client.stopApplication(externalId);
    return { accepted: true, message: response.message };
  }

  async restartApplication(externalId: string): Promise<ActionResult> {
    const response = await this.client.restartApplication(externalId);
    return { accepted: true, message: response.message };
  }

  async redeployApplication(externalId: string, options?: { force?: boolean }): Promise<ActionResult> {
    const response = await this.client.deploy(externalId, options?.force ?? false);
    const item = response.deployments?.[0];
    return { accepted: true, deploymentExternalId: item?.deployment_uuid, message: item?.message };
  }
}
