/**
 * Raw Coolify REST API (v1, `/api/v1`) shapes — only the fields this product
 * reads. Built from Coolify's documented public API; this environment's
 * network policy blocked a live check against https://coolify.io/docs during
 * this implementation, so treat field names here as best-effort and verify
 * against your instance's `/api/v1` responses before relying on anything not
 * already exercised by coolify-client.ts. Endpoints are centralized in
 * coolify-client.ts specifically so a mismatch is a one-file fix.
 */

export interface CoolifyApplicationRaw {
  uuid: string;
  name: string;
  description?: string | null;
  /** Compound field observed as "<state>[:<health>]", e.g. "running:healthy". */
  status: string;
  fqdn?: string | null;
  git_repository?: string | null;
  git_branch?: string | null;
}

/** A resource stub as it appears nested inside a project's environment — only the fields needed to link it back to an already-synced Application. */
export interface CoolifyEnvironmentResourceRaw {
  uuid: string;
  name?: string;
}

export interface CoolifyEnvironmentRaw {
  name?: string;
  applications?: CoolifyEnvironmentResourceRaw[];
  services?: CoolifyEnvironmentResourceRaw[];
  databases?: CoolifyEnvironmentResourceRaw[];
}

export interface CoolifyProjectRaw {
  uuid: string;
  name: string;
  description?: string | null;
}

/** `GET /api/v1/projects/{uuid}` — nests the environments (and therefore resources) that belong to the project. */
export interface CoolifyProjectDetailRaw extends CoolifyProjectRaw {
  environments?: CoolifyEnvironmentRaw[];
}

export interface CoolifyLogsRaw {
  logs: string;
}

export interface CoolifyDeploymentRaw {
  deployment_uuid: string;
  application_id?: string;
  application_uuid?: string;
  status: string; // "queued" | "in_progress" | "finished" | "failed" | "cancelled-by-user" ...
  commit?: string | null;
  commit_message?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CoolifyDeployTriggerResponseItem {
  resource_uuid: string;
  deployment_uuid: string;
  message?: string;
}

export interface CoolifyDeployTriggerResponse {
  deployments: CoolifyDeployTriggerResponseItem[];
}

export interface CoolifyActionResponse {
  message?: string;
}

export interface CoolifyVersionResponse {
  version?: string;
}
